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
  console.log('Servidor HTTP iniciado correctamente para el plan gratuito.');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Definición de Comandos Slash para el menú desplegable
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

  // Registrar comandos Slash globales en la API de Discord
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

// Evento que responde a las Interacciones (Comandos Slash, Menús desplegables y Botones)
client.on('interactionCreate', async (interaction) => {
  // 1. Manejo de Comandos Slash (Menú flotante de Discord)
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Necesitas permisos de Administrador.', ephemeral: true });
      }

      const role = interaction.options.getRole('rol');
      const categoryId = interaction.options.getString('categoria');

      config.supportRoleId = role.id;
      config.categoryId = categoryId;
      config.ticketChannelId = interaction.channel.id;
      saveConfig();

      const embed = new EmbedBuilder()
        .setTitle(config.panelTitle)
        .setDescription(config.panelDescription)
        .setColor('#5865F2');

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_ticket_category')
        .setPlaceholder('Selecciona una opción...')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Soporte Técnico').setDescription('Ayuda con errores').setValue('soporte').setEmoji('🛠️'),
          new StringSelectMenuOptionBuilder().setLabel('Facturación / Compras').setDescription('Dudas sobre pagos').setValue('compras').setEmoji('💳'),
          new StringSelectMenuOptionBuilder().setLabel('Reportes').setDescription('Denuncia a un usuario').setValue('reportes').setEmoji('🛑')
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: 'Panel enviado correctamente.', ephemeral: true });
    }

    if (commandName === 'setlogs') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

      try {
        const formattedName = formatLogsChannelName();
        const logsChannel = await interaction.guild.channels.create({
          name: formattedName,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        config.logsChannelId = logsChannel.id;
        saveConfig();

        return interaction.reply({ content: `✅ Canal de logs creado: ${logsChannel}`, ephemeral: true });
      } catch (error) {
        console.error(error);
        return interaction.reply({ content: 'Error al crear el canal de logs.', ephemeral: true });
      }
    }

    if (commandName === 'setpanel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

      const text = interaction.options.getString('texto');
      const [title, desc] = text.split('|');

      if (!title || !desc) {
        return interaction.reply({ content: 'Uso correcto: `Título | Descripción`', ephemeral: true });
      }

      config.panelTitle = title.trim();
      config.panelDescription = desc.trim();
      saveConfig();

      return interaction.reply({ content: 'Texto del panel actualizado.', ephemeral: true });
    }

    if (commandName === 'setrespuesta') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

      const text = interaction.options.getString('texto');
      const [title, desc] = text.split('|');

      if (!title || !desc) {
        return interaction.reply({ content: 'Uso correcto: `Título | Texto con {mensaje}`', ephemeral: true });
      }

      config.autoReplyTitle = title.trim();
      config.autoReplyDesc = desc.trim();
      saveConfig();

      return interaction.reply({ content: 'Respuesta automática actualizada.', ephemeral: true });
    }
  }

  // 2. Creación de Tickets vía Menú Desplegable
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_category') {
    const selectedCategory = interaction.values[0];
    const categoryNames = { soporte: 'Soporte Técnico', compras: 'Facturación y Compras', reportes: 'Reportes' };

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

    await channel.send({ content: `<@${interaction.user.id}> | Notificando a <@&${config.supportRoleId}>`, embeds: [embed], components: [row] });
    await interaction.reply({ content: `Tu ticket ha sido creado en ${channel}`, ephemeral: true });
  }

  // 3. Cierre de Tickets vía Botón
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await interaction.reply('Generando archivo de registros y eliminando el canal...');

    const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(fetchedMessages.values()).reverse();

    let transcriptText = `==================================================\nTRANSCRIPCIÓN DE LOGS: ${interaction.channel.name}\nFECHA DE CIERRE: ${new Date().toLocaleString()}\nCERRADO POR: ${interaction.user.tag} (${interaction.user.id})\n==================================================\n\n`;

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
          .addFields({ name: 'Canal', value: interaction.channel.name, inline: true }, { name: 'Cerrado por', value: `<@${interaction.user.id}>`, inline: true })
          .setColor('#ED4245')
          .setTimestamp();

        await logsChannel.send({ embeds: [logEmbed], files: [attachment] });
      }
    }

    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
  }
});

// Respuestas automáticas en mensajes normales dentro del ticket
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.name && message.channel.name.startsWith('ticket-')) {
    const messages = await message.channel.messages.fetch({ limit: 10 });
    const botReplies = messages.filter(
      m => m.author.id === client.user.id && 
      m.embeds.length > 0 && 
      m.embeds[0].title === config.autoReplyTitle
    );

    if (botReplies.size === 0 && config.autoReplyTitle) {
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

client.login(process.env.BOT_TOKEN);
