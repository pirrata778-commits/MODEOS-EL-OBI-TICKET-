const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ChannelType, PermissionFlagsBits, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');
const { db, statements, ensureSettings, parseSettings, logEvent } = require('../database');

const INITIAL_CATEGORIES = [
  { key: 'soporte-general', name: 'Soporte general', question: '¿En qué necesitas ayuda?' },
  { key: 'bots-discord', name: 'Ayuda con bots de Discord', question: '¿Qué bot o función te está dando problemas?' },
  { key: 'problemas-tecnicos', name: 'Problemas técnicos', question: '¿Qué error aparece y qué estabas haciendo?' },
  { key: 'compras-ventas', name: 'Compras y ventas', question: '¿Qué consulta tienes sobre compras o ventas?' },
  { key: 'presupuesto', name: 'Solicitud de presupuesto', question: '¿Qué necesitas y cuál es el alcance aproximado?' },
  { key: 'reportar', name: 'Reportar un problema', question: '¿Qué ocurrió y cuándo? No publiques datos sensibles.' },
  { key: 'otros', name: 'Otros asuntos', question: 'Cuéntanos brevemente tu consulta.' }
];

function categoriesFor(settings) { return settings.categories?.length ? settings.categories : INITIAL_CATEGORIES; }
function getTicket(channelId) { return statements.getTicket.get(channelId); }
function isSupport(interaction, settings, ticketRoleId = null) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || (settings.support_role_id && interaction.member?.roles?.cache?.has(settings.support_role_id)) || (ticketRoleId && interaction.member?.roles?.cache?.has(ticketRoleId)));
}
function canManage(interaction, settings) { return isSupport(interaction, settings); }
function ticketEmbed(ticket, owner) {
  return new EmbedBuilder().setColor(ticket.priority === 'urgent' ? 0xED4245 : ticket.priority === 'high' ? 0xFEE75C : 0x5865F2)
    .setTitle(`Ticket ${ticket.category_label}`)
    .setDescription(`**Solicitante:** <@${ticket.owner_id}>\n**Prioridad:** ${ticket.priority}\n**Estado:** ${ticket.status}${ticket.claimed_by ? `\n**Agente:** <@${ticket.claimed_by}>` : ''}\n**IA:** ${ticket.ai_enabled ? `activa (${ticket.ai_mode})` : 'pausada'}`)
    .setFooter({ text: `Ticket #${ticket.id} · Abierto por ${owner?.tag || ticket.owner_id}` });
}
function ticketControls() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Reclamar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Cerrar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:human').setLabel('Solicitar personal').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:ai').setLabel('Pausar / activar IA').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:ask-ai').setLabel('Preguntar a la IA').setStyle(ButtonStyle.Success)
  )];
}

async function publishPanel(guild, channel) {
  const settings = parseSettings(ensureSettings(guild.id));
  const menu = new StringSelectMenuBuilder().setCustomId('ticket:category').setPlaceholder('¿En qué necesitas ayuda?')
    .addOptions(categoriesFor(settings).slice(0, 25).map(category => new StringSelectMenuOptionBuilder()
      .setLabel(category.name.slice(0, 100)).setDescription(category.question.slice(0, 100)).setValue(category.key)));
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(settings.panel_title)
    .setDescription(settings.panel_description).setFooter({ text: 'MODEOS EL OBI · Atención privada' });
  const sent = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
  db.prepare('UPDATE guild_settings SET panel_channel_id=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(channel.id, guild.id);
  return sent;
}

function buildIntakeModal(category, settings) {
  const question = new TextInputBuilder().setCustomId('problem').setLabel(category.question.slice(0, 45)).setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Incluye el contexto necesario. No compartas contraseñas ni tokens.').setRequired(true).setMaxLength(1500);
  const questionHint = settings.intakeQuestions?.length ? settings.intakeQuestions.join('; ').slice(0, 100) : 'Incluye cualquier dato útil que todavía no hayas mencionado.';
  const details = new TextInputBuilder().setCustomId('details').setLabel('Datos adicionales (opcional)').setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(questionHint)
    .setRequired(false).setMaxLength(1000);
  return new ModalBuilder().setCustomId(`ticket:create:${category.key}`).setTitle(`Abrir: ${category.name}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(question), new ActionRowBuilder().addComponents(details));
}

async function createTicket(interaction, category, form) {
  const settings = parseSettings(ensureSettings(interaction.guildId));
  const supportRoleId = category.supportRoleId || settings.support_role_id;
  const parentCategoryId = category.discordCategoryId || settings.default_category_id;
  if (!supportRoleId || !parentCategoryId) throw new Error('SETUP_INCOMPLETE');
  if (!interaction.guild.roles.cache.has(supportRoleId)) await interaction.guild.roles.fetch(supportRoleId).catch(() => null);
  if (!interaction.guild.roles.cache.has(supportRoleId) || !interaction.guild.channels.cache.has(parentCategoryId)) throw new Error('SETUP_INCOMPLETE');
  if (statements.blacklistGet.get(interaction.guildId, interaction.user.id)) throw new Error('BLACKLISTED');
  const open = statements.openTickets.all(interaction.guildId, interaction.user.id);
  if (settings.allow_same_category && statements.openSameCategory.get(interaction.guildId, interaction.user.id, category.key)) throw new Error('DUPLICATE_CATEGORY');
  if (!settings.allow_same_category && open.length) throw new Error('ALREADY_OPEN');
  const reservationKey = settings.allow_same_category ? category.key : '*';
  try {
    db.prepare('INSERT INTO ticket_reservations(guild_id,owner_id,category_key) VALUES (?,?,?)').run(interaction.guildId, interaction.user.id, reservationKey);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error(settings.allow_same_category ? 'DUPLICATE_CATEGORY' : 'ALREADY_OPEN');
    throw error;
  }
  const safe = interaction.user.username.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'usuario';
  const topic = `modeos-ticket;owner=${interaction.user.id};category=${category.key}`;
  let channel;
  try {
  channel = await interaction.guild.channels.create({
    name: `ticket-${safe}`,
    type: ChannelType.GuildText,
    parent: parentCategoryId,
    topic,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
    ]
  });
    const info = db.transaction(() => {
      const initialMessage = [form.problem, form.details && `Datos adicionales: ${form.details}`].filter(Boolean).join('\n\n');
      statements.createTicket.run(interaction.guildId, channel.id, interaction.user.id, category.key, category.name, Number(settings.ai_enabled), settings.ai_mode, initialMessage, supportRoleId);
      const row = statements.getTicket.get(channel.id);
      logEvent(row.id, interaction.user.id, 'opened', `Categoría: ${category.name}`);
      return row;
    })();
    const embed = new EmbedBuilder().setColor(0x57F287).setTitle(`Hola, soy ${settings.assistant_name || 'Modeos el Obi'}, el asistente virtual`)
      .setDescription(`${settings.welcome_text}\n\n**Categoría:** ${category.name}\n**Tu consulta:**\n${form.problem}${form.details ? `\n\n**Información adicional:**\n${form.details}` : ''}${settings.intakeQuestions?.length ? `\n\n**Datos útiles para el equipo:** ${settings.intakeQuestions.join(', ')}` : ''}\n\nEl equipo podrá ver esta conversación. Puedes pedir intervención humana cuando quieras.`)
      .setFooter({ text: `Ticket #${info.id} · ${interaction.user.tag}` });
    await channel.send({ content: `<@${interaction.user.id}> · <@&${supportRoleId}>`, embeds: [embed, ticketEmbed(info, interaction.user)], components: ticketControls(), allowedMentions: { users: [interaction.user.id], roles: [supportRoleId] } });
    db.prepare('DELETE FROM ticket_reservations WHERE guild_id=? AND owner_id=? AND category_key=?').run(interaction.guildId, interaction.user.id, reservationKey);
    return channel;
  } catch (error) {
    if (channel) {
      const record = statements.getTicket.get(channel.id);
      if (record?.status === 'open') db.prepare("UPDATE tickets SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?").run(record.id);
      await channel.delete('No se pudo inicializar el ticket').catch(() => {});
    }
    db.prepare('DELETE FROM ticket_reservations WHERE guild_id=? AND owner_id=? AND category_key=?').run(interaction.guildId, interaction.user.id, reservationKey);
    throw error;
  }
}

function actionRowsCloseConfirm() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close-confirm').setLabel('Sí, cerrar ticket').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:close-cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
}

module.exports = { INITIAL_CATEGORIES, categoriesFor, getTicket, isSupport, canManage, ticketEmbed, ticketControls, publishPanel, buildIntakeModal, createTicket, actionRowsCloseConfirm };
