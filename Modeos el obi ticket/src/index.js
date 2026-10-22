const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, REST, Routes } = require('discord.js');
const config = require('./config');
const commands = require('./commands');
const { db, statements, ensureSettings, parseSettings, logEvent } = require('./database');
const { handleInteraction, aiErrorMessage } = require('./handlers/interactions');
const { answerTicket } = require('./services/ai');
const { categoriesFor } = require('./services/tickets');

if (!config.token || !config.applicationId) {
  console.error('Faltan DISCORD_TOKEN o DISCORD_APPLICATION_ID. Revisa el archivo .env.example y configura .env.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let ready = false;
const inFlight = new Set();
const missingAiNotified = new Set();
db.prepare("DELETE FROM ticket_reservations WHERE created_at < datetime('now','-10 minutes')").run();

const healthServer = http.createServer((request, response) => {
  if (request.url !== '/health' && request.url !== '/ready') {
    response.writeHead(404).end('Not found');
    return;
  }
  const healthy = request.url === '/health' || ready;
  response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ status: healthy ? 'ok' : 'starting', discord: ready }));
});
healthServer.listen(config.port, '0.0.0.0', () => console.log(`Health endpoint escuchando en :${config.port}`));

client.once('clientReady', async () => {
  console.log(`MODEOS EL OBI TICKETS conectado como ${client.user.tag}`);
  console.log(`IA ${config.aiGlobalEnabled ? 'habilitada por configuración' : 'deshabilitada'}; proveedor ${config.aiProvider}.`);
  if (!config.aiApiKey) console.warn('AI_API_KEY no está configurada; los tickets funcionan y la IA permanecerá disponible para activarse después.');
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const route = config.testGuildId
      ? Routes.applicationGuildCommands(config.applicationId, config.testGuildId)
      : Routes.applicationCommands(config.applicationId);
    await rest.put(route, { body: commands });
    console.log(`Registrados ${commands.length} comandos ${config.testGuildId ? 'en el servidor de pruebas' : 'globalmente'}.`);
  } catch (error) {
    console.error('No se pudieron registrar los comandos slash al arrancar:', error.message);
  }
  for (const guild of client.guilds.cache.values()) {
    const settings = parseSettings(ensureSettings(guild.id));
    const channels = await guild.channels.fetch().catch(error => {
      console.error(`No pude revisar canales al recuperar tickets (${guild.id}): ${error.message}`);
      return null;
    });
    if (!channels) continue;
    for (const channel of channels.values()) {
      const match = /^modeos-ticket;owner=(\d{17,20});category=([a-z0-9-]{1,32})$/.exec(channel.topic || '');
      if (!match || statements.getTicket.get(channel.id)) continue;
      const category = categoriesFor(settings).find(item => item.key === match[2]);
      if (!category) continue;
      try {
        statements.createTicket.run(guild.id, channel.id, match[1], category.key, category.name, Number(settings.ai_enabled), settings.ai_mode, '', category.supportRoleId || settings.support_role_id);
        const restored = statements.getTicket.get(channel.id);
        logEvent(restored.id, null, 'recovered_after_restart', 'Ticket canal recuperado desde el tema del canal.');
        console.info(`Ticket ${restored.id} recuperado tras reiniciar.`);
      } catch (error) {
        console.error(`No pude recuperar un canal de ticket (${channel.id}): ${error.message}`);
      }
    }
    const openTickets = db.prepare("SELECT id,channel_id FROM tickets WHERE guild_id=? AND status='open'").all(guild.id);
    for (const ticket of openTickets) {
      if (channels.has(ticket.channel_id)) continue;
      db.prepare("UPDATE tickets SET status='closed',closed_at=CURRENT_TIMESTAMP,closed_by='system' WHERE id=?").run(ticket.id);
      logEvent(ticket.id, null, 'channel_missing_after_restart', 'El canal no existe; ticket archivado para liberar duplicados.');
    }
  }
  ready = true;
});

client.on('guildCreate', guild => { ensureSettings(guild.id); console.info(`Bot añadido a un servidor (${guild.id}).`); });

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild || message.channel.type !== ChannelType.GuildText) return;
  const ticket = statements.getTicket.get(message.channel.id);
  if (!ticket || ticket.status !== 'open') return;
  if (inFlight.has(message.channel.id)) return;
  const settings = parseSettings(ensureSettings(message.guild.id));
  const memberIsStaff = Boolean((ticket.support_role_id && message.member?.roles?.cache?.has(ticket.support_role_id)) || (settings.support_role_id && message.member?.roles?.cache?.has(settings.support_role_id)));
  if (memberIsStaff || message.member?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    if (ticket.ai_enabled) {
      statements.updateAi.run(0, ticket.ai_mode, ticket.id);
      logEvent(ticket.id, message.author.id, 'ai_paused_for_human', 'Pausa automática al responder un agente.');
      await message.channel.send({ content: 'La IA se ha pausado mientras atiende el equipo. Un agente puede reactivarla con el comando /ticket-ia activar.' }).catch(() => {});
    }
    return;
  }

  const mention = message.mentions.users.has(client.user.id);
  if (!config.aiGlobalEnabled || !settings.ai_enabled || !ticket.ai_enabled) return;
  if (ticket.ai_mode === 'manual' && !mention) return;

  inFlight.add(message.channel.id);
  try {
    await message.channel.sendTyping();
    const answer = await answerTicket(message.channel, ticket, settings, message.author.id, { force: ticket.ai_mode === 'manual' });
    const current = statements.getTicket.get(message.channel.id);
    if (!current || current.status !== 'open' || !current.ai_enabled) return;
    const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
  } catch (error) {
    const userMessage = aiErrorMessage(error);
    if (error.message === 'AI_NOT_CONFIGURED') {
      if (!missingAiNotified.has(ticket.guild_id)) {
        missingAiNotified.add(ticket.guild_id);
        await message.reply('El asistente virtual no tiene proveedor de IA configurado. Puedes seguir explicando tu consulta y el equipo de soporte podrá ayudarte.').catch(() => {});
      }
    } else if (error.message !== 'AI_PAUSED' && error.message !== 'AI_MANUAL_MODE') {
      console.error(`IA ticket=${ticket.id}: ${error.message}`);
      await message.reply(userMessage).catch(() => {});
    }
  } finally {
    inFlight.delete(message.channel.id);
  }
});

client.on('interactionCreate', handleInteraction);
client.on('error', error => console.error('Discord client:', error.message));
process.on('unhandledRejection', error => console.error('Promesa no gestionada:', error?.message || 'error desconocido'));
process.on('uncaughtException', error => {
  console.error('Error no capturado:', error.message);
  shutdown(1);
});

async function cleanupTranscripts() {
  const cutoff = Date.now() - config.retentionDays * 86400000;
  const directory = path.resolve('./data/transcripts');
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(directory, entry.name);
      const stat = await fs.stat(file);
      if (stat.mtimeMs < cutoff) await fs.unlink(file);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Limpieza de transcripciones:', error.message);
  }
}
cleanupTranscripts();
const cleanupTimer = setInterval(cleanupTranscripts, 24 * 60 * 60 * 1000);

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  clearInterval(cleanupTimer);
  healthServer.close();
  try { await client.destroy(); } catch {}
  try { db.close(); } catch {}
  process.exit(code);
}
process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

client.login(config.token).catch(error => {
  console.error('No se pudo iniciar sesión en Discord. Revisa el token:', error.message);
  shutdown(1);
});
