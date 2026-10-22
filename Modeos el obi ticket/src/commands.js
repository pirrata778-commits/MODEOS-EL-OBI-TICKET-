const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const admin = PermissionFlagsBits.ManageGuild;

const commands = [
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Publica o actualiza el panel de tickets.').setDefaultMemberPermissions(admin)
    .addChannelOption(o => o.setName('canal').setDescription('Canal donde publicar el panel').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('ticket-setup').setDescription('Configura los canales y el rol de soporte.').setDefaultMemberPermissions(admin)
    .addRoleOption(o => o.setName('rol-soporte').setDescription('Rol autorizado para atender tickets'))
    .addChannelOption(o => o.setName('categoria').setDescription('Categoría de canales de tickets').addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption(o => o.setName('registros').setDescription('Canal privado de transcripciones').addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName('canal-panel').setDescription('Canal del panel').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('ticket-config').setDescription('Consulta o cambia la configuración del sistema.')
    .addSubcommand(s => s.setName('ver').setDescription('Muestra la configuración actual.'))
    .addSubcommand(s => s.setName('servidor').setDescription('Define la descripción y preguntas de admisión.')
      .addStringOption(o => o.setName('descripcion').setDescription('Qué ofrece la comunidad (máximo 1000 caracteres)').setRequired(true).setMaxLength(1000))
      .addStringOption(o => o.setName('preguntas').setDescription('Preguntas separadas por ; (máximo 800 caracteres)').setMaxLength(800))
      .addStringOption(o => o.setName('asistente').setDescription('Nombre visible del asistente virtual').setMaxLength(80)))
    .addSubcommand(s => s.setName('bienvenida').setDescription('Cambia el texto inicial del ticket.')
      .addStringOption(o => o.setName('texto').setDescription('Saludo y orientación inicial (máximo 900 caracteres)').setRequired(true).setMaxLength(900)))
    .addSubcommand(s => s.setName('panel').setDescription('Cambia el título y la descripción del panel.')
      .addStringOption(o => o.setName('titulo').setDescription('Título del panel').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('descripcion').setDescription('Descripción del panel').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('ia-global').setDescription('Activa o pausa la IA en el servidor.')
      .addBooleanOption(o => o.setName('activa').setDescription('Estado de la IA').setRequired(true)))
    .addSubcommand(s => s.setName('modo-ia').setDescription('Selecciona cómo responde la IA.')
      .addStringOption(o => o.setName('modo').setDescription('Automática o solo bajo demanda').setRequired(true)
        .addChoices({ name: 'Automática', value: 'auto' }, { name: 'Bajo demanda', value: 'manual' })))
    .addSubcommand(s => s.setName('duplicados').setDescription('Configura si se permiten varios tickets abiertos por persona.')
      .addBooleanOption(o => o.setName('permitir-otras-categorias').setDescription('Permite un ticket por categoría en vez de uno en total').setRequired(true)))
    .addSubcommand(s => s.setName('categoria').setDescription('Añade o actualiza una categoría de tickets.')
      .addStringOption(o => o.setName('clave').setDescription('Clave corta, por ejemplo soporte-general').setRequired(true).setMaxLength(32))
      .addStringOption(o => o.setName('nombre').setDescription('Nombre visible de la categoría').setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName('pregunta').setDescription('Dato que solicitará el modal').setRequired(true).setMaxLength(100))
      .addChannelOption(o => o.setName('categoria-discord').setDescription('Categoría de canales específica para este tipo de ticket').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption(o => o.setName('rol-soporte').setDescription('Rol de soporte específico para esta categoría'))),
  new SlashCommandBuilder().setName('ticket-add').setDescription('Añade a una persona al ticket actual.')
    .addUserOption(o => o.setName('usuario').setDescription('Persona que se añadirá').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-remove').setDescription('Retira a una persona del ticket actual.')
    .addUserOption(o => o.setName('usuario').setDescription('Persona que se retirará').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-claim').setDescription('Reclama o libera el ticket actual.')
    .addStringOption(o => o.setName('accion').setDescription('Acción').setRequired(true).addChoices({ name: 'Reclamar', value: 'claim' }, { name: 'Liberar', value: 'release' })),
  new SlashCommandBuilder().setName('ticket-close').setDescription('Cierra y archiva el ticket actual.'),
  new SlashCommandBuilder().setName('ticket-reopen').setDescription('Reabre el ticket archivado actual.'),
  new SlashCommandBuilder().setName('ticket-priority').setDescription('Cambia la prioridad del ticket actual.')
    .addStringOption(o => o.setName('nivel').setDescription('Prioridad nueva').setRequired(true)
      .addChoices({ name: 'Baja', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'Alta', value: 'high' }, { name: 'Urgente', value: 'urgent' })),
  new SlashCommandBuilder().setName('ticket-transfer').setDescription('Cambia el equipo o la categoría del ticket.')
    .addStringOption(o => o.setName('categoria').setDescription('Clave de categoría destino').setRequired(true).setMaxLength(32)),
  new SlashCommandBuilder().setName('ticket-info').setDescription('Muestra información y notas internas del ticket actual.'),
  new SlashCommandBuilder().setName('ticket-note').setDescription('Guarda una nota interna invisible para el usuario.')
    .addStringOption(o => o.setName('texto').setDescription('Nota para el siguiente agente').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('ticket-summary').setDescription('Resume la conversación para el relevo del equipo.'),
  new SlashCommandBuilder().setName('ticket-transcript').setDescription('Genera una transcripción del ticket actual.'),
  new SlashCommandBuilder().setName('ticket-stats').setDescription('Muestra estadísticas del servidor.').setDefaultMemberPermissions(admin),
  new SlashCommandBuilder().setName('ticket-ia').setDescription('Controla la asistencia IA del ticket actual.')
    .addSubcommand(s => s.setName('activar').setDescription('Activa la IA para este ticket.'))
    .addSubcommand(s => s.setName('pausar').setDescription('Pausa la IA mientras atiende el personal.'))
    .addSubcommand(s => s.setName('modo').setDescription('Cambia el modo de respuesta de este ticket.')
      .addStringOption(o => o.setName('modo').setDescription('Automática o bajo demanda').setRequired(true)
        .addChoices({ name: 'Automática', value: 'auto' }, { name: 'Bajo demanda', value: 'manual' })))
    .addSubcommand(s => s.setName('sugerir').setDescription('Prepara una respuesta para que el agente la revise.')),
  new SlashCommandBuilder().setName('ticket-blacklist').setDescription('Gestiona la lista de bloqueo de tickets.')
    .addSubcommand(s => s.setName('agregar').setDescription('Bloquea a una persona para abrir tickets.')
      .addUserOption(o => o.setName('usuario').setDescription('Persona').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo').setMaxLength(300)))
    .addSubcommand(s => s.setName('quitar').setDescription('Retira a una persona de la lista.')
      .addUserOption(o => o.setName('usuario').setDescription('Persona').setRequired(true))),
  new SlashCommandBuilder().setName('ticket-help').setDescription('Muestra la ayuda del sistema de tickets.')
].map(command => command.toJSON());

module.exports = commands;
