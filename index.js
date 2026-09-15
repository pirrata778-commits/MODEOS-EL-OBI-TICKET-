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
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
let config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function saveConfig() {
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
}

// Transformador de texto para fuentes especiales en Discord
function formatLogsChannelName(text) {
  // Mapa de caracteres estilo Negrita/Sans-Serif Bold Unicode
  const fontMap = {
    'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴',
    'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻',
    'o': '𝗼', 'p': '𝗽', 'q': ' drain', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂',
    'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇', '-': '⁃', 'l': '𝗹',
    'o': '𝗼', 'g': '𝗴', 's': '𝘀'
  };

  // Puedes cambiar el nombre base e iconos del canal aquí:
  const baseName = "📁⁃l𝗼g𝘀⁃t𝗶𝗰𝗸𝗲𝘁𝘀"; 
  return baseName;
}

client.once('ready', () => {
  console.log(`========================================`);
  console.log(`Bot iniciado con éxito como: ${client.user.tag}`);
  console.log(`Prefijo configurado: /`);
  console.log(`Listo para bot-hosting.net`);
  console.log(`========================================`);
});

// COMANDOS DE CONFIGURACIÓN
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 1. Comando: /setup @RolSoporte ID_Categoria
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

  // 2. Comando: /setlogs (Crea el canal de logs automáticamente)
  if (message.content.startsWith('/setlogs')) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    try {
      const formattedName = formatLogsChannelName();

      // Crea el canal automáticamente con fuentes especiales y permisos privados
      const logsChannel = await message.guild.channels.create({
        name: formattedName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: message.guild.id,
            deny: [PermissionFlagsBits.ViewChannel] // Oculto para todos los miembros
          },
          {
            id: message.author.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] // Visible para Administradores
          }
        ]
      });

      config.logsChannelId = logsChannel.id;
      saveConfig();

      return message.reply(`✅ Canal de logs creado automáticamente con tipo de letra personalizado: ${logsChannel}`);
    } catch (error) {
      console.error(error);
      return message.reply(' Hubo un error al intentar crear el canal de logs. Verifica los permisos del bot.');
    }
  }

  // 3. Comando: /setpanel Título | Descripción
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

    return message.reply('Texto del panel actualizado. Vuelve a ejecutar `/setup` para enviar el panel actualizado.');
  }

  // 4. Comando: /setrespuesta Título | Descripción
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

  // RESPUESTA AUTOMÁTICA DENTRO DEL CANAL DE TICKET
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

// INTERACCIONES (MENÚS Y BOTONES)
client.on('interactionCreate', async (interaction) => {

  // Creación de Ticket
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

  // Cierre de Ticket y Guardado en Logs
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

client.login(config.token);