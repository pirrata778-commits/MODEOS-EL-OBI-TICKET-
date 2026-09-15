const http = require('http');
const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder, 
  ChannelType, 
  PermissionFlagsBits,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
let config = require('./config.json');

// Servidor Web para el plan gratuito de Render
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot activo 24/7');
}).listen(process.env.PORT || 10000, () => {
  console.log('Servidor HTTP iniciado correctamente.');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Definición de Comandos Slash para el menú emergente de Discord
const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configura el panel de tickets')
    .addRoleOption(opt => opt.setName('rol').setDescription('Rol de soporte').setRequired(true))
    .addStringOption(opt => opt.setName('categoria').setDescription('ID de la categoría').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Crea el canal automático para guardar logs'),
  new SlashCommandBuilder()
    .setName('setpanel')
    .setDescription('Configura título y descripción del panel')
    .addStringOption(opt => opt.setName('texto').setDescription('Título | Descripción').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setrespuesta')
    .setDescription('Configura la respuesta automática dentro del ticket')
    .addStringOption(opt => opt.setName('texto').setDescription('Título | Texto con {mensaje}').setRequired(true))
];

function saveConfig() {
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

function formatLogsChannelName() {
  return "📁⁃l𝗼g𝘀⁃t𝗶𝗰𝗸𝗲𝘁𝘀"; 
}

client.once('ready', async () => {
  console.log(`========================================`);
  console.log(`Bot iniciado con éxito como: ${client.user.tag}`);
  console.log(`========================================`);

  // Registrar comandos Slash globales en Discord
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    console.log('Cargando comandos slash en Discord...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('¡Comandos Slash cargados correctamente!');
  } catch (error) {
    console.error('Error al registrar comandos slash:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('/setup')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('Necesitas permisos de Administrador para usar este comando.');
    }

    const args = message.content.split(/ +/).slice(1);
    const role = message.mentions.roles.first();
    const categoryId = args[1];

    if (!role || !categoryId) {
      return message.reply('Uso correcto: `/setup @RolSoporte ID_Categoria`');
    }

    config.supportRoleId = role.id;
    config.categoryId = categoryId;
    config.ticketChannelId = message.channel.id;
    saveConfig();

    const embed = new EmbedBuilder()
      .setTitle(config.panelTitle)
      .setDescription(config.panelDescription)
      .setColor('#5865F2');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_ticket_category')
      .setPlaceholder('Selecciona una opción...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Soporte Técnico')
          .setDescription('Ayuda con errores, problemas o configuración')
          .setValue('soporte')
          .setEmoji('🛠️'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Facturación / Compras')
          .setDescription('Dudas sobre pagos, donaciones o tienda')
          .setValue('compras')
          .setEmoji('💳'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Reportes')
          .setDescription('Denuncia a un usuario o mal comportamiento')
          .setValue('reportes')
          .setEmoji('🛑')
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('Panel de tickets enviado y guardado correctamente.');
  }

  if (message.content.startsWith('/setlogs')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    try {
      const formattedName = formatLogsChannelName();

      const logsChannel = await message.guild.channels.create({
        name: formattedName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: message.guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: message.author.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]
      });

      config.logsChannelId = logsChannel.id;
      saveConfig();

      return message.reply(`✅ Canal de logs creado automáticamente: ${logsChannel}`);
    } catch (error) {
      console.error(error);
      return message.reply('Hubo un error al intentar crear el canal de logs.');
    }
  }

  if (message.content.startsWith('/setpanel')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const text = message.content.slice(9).trim();
    const [title, desc] = text.split('|');

    if (!title || !desc) {
      return message.reply('Uso correcto: `/setpanel Título del Panel | Descripción del Panel`');
    }

    config.panelTitle = title.trim();
    config.panelDescription = desc.trim();
    saveConfig();

    return message.reply('Texto del panel actualizado.');
  }

  if (message.content.startsWith('/setrespuesta')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const text = message.content.slice(13).trim();
    const [title, desc] = text.split('|');

    if (!title || !desc) {
      return message.reply('Uso correcto: `/setrespuesta Título de Respuesta | Texto con {mensaje}`');
    }

    config.autoReplyTitle = title.trim();
    config.autoReplyDesc = desc.trim();
    saveConfig();

    return message.reply('Respuesta automática del bot dentro de los tickets actualizada.');
  }

  if (message.channel.name.startsWith('ticket-')) {
    const messages = await message.channel.messages.fetch({ limit: 10 });
    const botReplies = messages.filter(
      m => m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].title === config.autoReplyTitle
    );

    if (botReplies.size === 0) {
      const customDescription = config.autoReplyDesc.replace('{mensaje}', message.content);

      const autoReplyEmbed = new EmbedBuilder()
        .setTitle(config.autoReplyTitle)
        .setDescription(customDescription)
        .setColor('#FEE75C')
        .setTimestamp();

      await message.channel.send({ embeds: [autoReplyEmbed] });
    }
  }
});

client.on('interactionCreate', async (interaction) => {

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_category') {
    const selectedCategory = interaction.values[0];
    const categoryNames = {
      soporte: 'Soporte Técnico',
      compras: 'Facturación y Compras',
      reportes: 'Reportes'
    };

    const channelName = `ticket-${interaction.user.username.toLowerCase()}`;
    const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);

    if (existingChannel) {
      return interaction.reply({ content: `Ya tienes un ticket abierto en ${existingChannel}`, ephemeral: true });
    }

    const channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.categoryId || null,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: config.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });

    const embed = new EmbedBuilder()
      .setTitle(`Categoría: ${categoryNames[selectedCategory]}`)
      .setDescription(config.ticketWelcomeDesc)
      .setColor('#57F287')
      .setFooter({ text: `Ticket abierto por ${interaction.user.tag}` });

    const closeButton = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Cerrar Ticket y Guardar Logs')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const row = new ActionRowBuilder().addComponents(closeButton);

    await channel.send({ 
      content: `<@${interaction.user.id}> | Notificando a <@&${config.supportRoleId}>`, 
      embeds: [embed], 
      components: [row] 
    });

    await interaction.reply({ content: `Tu ticket ha sido creado en ${channel}`, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await interaction.reply('Generando archivo de registros y eliminando el canal...');

    const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(fetchedMessages.values()).reverse();

    let transcriptText = `==================================================\n`;
    transcriptText += `TRANSCRIPCIÓN DE LOGS: ${interaction.channel.name}\n`;
    transcriptText += `FECHA DE CIERRE: ${new Date().toLocaleString()}\n`;
    transcriptText += `CERRADO POR: ${interaction.user.tag} (${interaction.user.id})\n`;
    transcriptText += `==================================================\n\n`;

    sortedMessages.forEach(msg => {
      const timestamp = new Date(msg.createdTimestamp).toLocaleString();
      const content = msg.content || (msg.embeds.length > 0 ? '[Mensaje con Embed/Botón]' : '');
      transcriptText += `[${timestamp}] ${msg.author.tag}: ${content}\n`;
    });

    const buffer = Buffer.from(transcriptText, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `${interaction.channel.name}-log.txt` });

    if (config.logsChannelId) {
      const logsChannel = interaction.guild.channels.cache.get(config.logsChannelId);
      if (logsChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📜 Ticket Cerrado')
          .addFields(
            { name: 'Canal', value: interaction.channel.name, inline: true },
            { name: 'Cerrado por', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setColor('#ED4245')
          .setTimestamp();

        await logsChannel.send({ embeds: [logEmbed], files: [attachment] });
      }
    }

    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
  }
});

client.login(process.env.BOT_TOKEN);
