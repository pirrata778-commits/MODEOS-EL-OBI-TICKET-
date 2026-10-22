const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType,
  PermissionFlagsBits, AttachmentBuilder
} = require('discord.js');
const { db, statements, ensureSettings, parseSettings, logEvent, logGuildAction } = require('../database');
const config = require('../config');
const { answerTicket, askModel } = require('../services/ai');
const { buildTranscript } = require('../services/transcripts');
const {
  INITIAL_CATEGORIES, categoriesFor, getTicket, isSupport, publishPanel, buildIntakeModal,
  createTicket, actionRowsCloseConfirm
} = require('../services/tickets');

const staffOnlyMessage = 'Esta acción está reservada al equipo de soporte.';
const priorities = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const reply = (interaction, content, ephemeral = true) => interaction.reply({ content, ephemeral });
const updateResponse = (interaction, content) => interaction.update({ content });

function currentTicket(interaction) {
  return getTicket(interaction.channelId);
}
function settingsFor(interaction) {
  return parseSettings(ensureSettings(interaction.guildId));
}
function staff(interaction) { return isSupport(interaction, settingsFor(interaction), currentTicket(interaction)?.support_role_id); }
function ticketOnly(interaction) {
  const ticket = currentTicket(interaction);
  if (!ticket) return null;
  return ticket;
}
function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}
function cleanCategoryKey(value) { return /^[a-z0-9-]{1,32}$/.test(value); }

async function runCommand(interaction) {
  const name = interaction.commandName;
  const ticket = ticketOnly(interaction);
  if (['ticket-add','ticket-remove','ticket-claim','ticket-close','ticket-reopen','ticket-priority','ticket-transfer','ticket-info','ticket-note','ticket-summary','ticket-transcript','ticket-ia'].includes(name) && !ticket) {
    return reply(interaction, 'Usa este comando dentro del canal del ticket correspondiente.');
  }
  if (ticket?.status === 'closed' && ['ticket-add','ticket-remove','ticket-claim','ticket-close','ticket-priority','ticket-transfer','ticket-note','ticket-summary','ticket-ia'].includes(name)) {
    return reply(interaction, 'El ticket está cerrado. Reábrelo antes de modificarlo.');
  }

  if (name === 'ticket-help') return reply(interaction,
    '**MODEOS EL OBI · Ayuda de tickets**\n' +
    'Usuarios: abre un ticket desde el panel, aporta contexto y usa **Solicitar personal** si necesitas un agente.\n' +
    'Personal: `/ticket-claim`, `/ticket-add`, `/ticket-remove`, `/ticket-priority`, `/ticket-transfer`, `/ticket-note`, `/ticket-summary`, `/ticket-info`, `/ticket-transcript`, `/ticket-close` y `/ticket-reopen`.\n' +
    'Administración: `/ticket-setup`, `/ticket-panel`, `/ticket-config`, `/ticket-stats` y `/ticket-blacklist`.\n' +
    'La IA se controla con `/ticket-ia` y `/ticket-config`; funciona solo cuando el servidor y el ticket la tienen activa.');

  if (name === 'ticket-setup') {
    if (!hasManageGuild(interaction)) return reply(interaction, 'Necesitas permiso **Gestionar servidor**.');
    const role = interaction.options.getRole('rol-soporte');
    const category = interaction.options.getChannel('categoria');
    const logs = interaction.options.getChannel('registros');
    const panel = interaction.options.getChannel('canal-panel');
    const old = ensureSettings(interaction.guildId);
    const result = {
      panel_channel_id: panel?.id || old.panel_channel_id,
      support_role_id: role?.id || old.support_role_id,
      logs_channel_id: logs?.id || old.logs_channel_id,
      default_category_id: category?.id || old.default_category_id
    };
    db.prepare('UPDATE guild_settings SET panel_channel_id=?,support_role_id=?,logs_channel_id=?,default_category_id=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?')
      .run(result.panel_channel_id, result.support_role_id, result.logs_channel_id, result.default_category_id, interaction.guildId);
    logGuildAction(interaction.guildId, interaction.user.id, 'ticket_setup', 'Actualizó los destinos y rol de soporte.');
    return reply(interaction, `Configuración guardada.\nRol: ${result.support_role_id ? `<@&${result.support_role_id}>` : 'pendiente'} · Categoría: ${result.default_category_id ? `<#${result.default_category_id}>` : 'pendiente'} · Registros: ${result.logs_channel_id ? `<#${result.logs_channel_id}>` : 'pendiente'}.`);
  }

  if (name === 'ticket-panel') {
    if (!hasManageGuild(interaction)) return reply(interaction, 'Necesitas permiso **Gestionar servidor**.');
    const settings = settingsFor(interaction);
    const channel = interaction.options.getChannel('canal') || (settings.panel_channel_id && await interaction.guild.channels.fetch(settings.panel_channel_id).catch(() => null)) || interaction.channel;
    if (!channel?.isTextBased()) return reply(interaction, 'Elige un canal de texto válido para el panel.');
    const message = await publishPanel(interaction.guild, channel);
    return reply(interaction, `Panel publicado en ${channel}: ${message.url}`);
  }

  if (name === 'ticket-config') {
    const sub = interaction.options.getSubcommand();
    const settings = settingsFor(interaction);
    if (sub === 'ver') return reply(interaction, `**Configuración de tickets**\nRol soporte: ${settings.support_role_id ? `<@&${settings.support_role_id}>` : 'sin configurar'}\nCategoría: ${settings.default_category_id ? `<#${settings.default_category_id}>` : 'sin configurar'}\nCanal de registros: ${settings.logs_channel_id ? `<#${settings.logs_channel_id}>` : 'sin configurar'}\nIA global: ${settings.ai_enabled ? 'activa' : 'pausada'} · Modo: ${settings.ai_mode}\nDescripción: ${settings.server_description || 'sin configurar'}\nCategorías: ${categoriesFor(settings).map(c => c.name).join(', ')}`);
    if (!hasManageGuild(interaction)) return reply(interaction, 'Necesitas permiso **Gestionar servidor** para cambiar esta opción.');
    if (sub === 'servidor') {
      const description = interaction.options.getString('descripcion', true).trim();
      const questions = (interaction.options.getString('preguntas') || '').split(';').map(q => q.trim()).filter(Boolean).slice(0, 10);
      const assistant = (interaction.options.getString('asistente') || settings.assistant_name || 'Modeos el Obi').trim();
      db.prepare('UPDATE guild_settings SET server_description=?,intake_questions=?,assistant_name=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(description, JSON.stringify(questions), assistant, interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'server_profile_updated', 'Actualizó la descripción del servidor y las preguntas de admisión.');
      return reply(interaction, `Descripción guardada y ${questions.length} preguntas de admisión configuradas.`);
    }
    if (sub === 'bienvenida') {
      const text = interaction.options.getString('texto', true).trim();
      db.prepare('UPDATE guild_settings SET welcome_text=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(text, interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'welcome_updated');
      return reply(interaction, 'Mensaje de bienvenida actualizado para los próximos tickets.');
    }
    if (sub === 'panel') {
      const title = interaction.options.getString('titulo', true).trim();
      const description = interaction.options.getString('descripcion', true).trim();
      db.prepare('UPDATE guild_settings SET panel_title=?,panel_description=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(title, description, interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'panel_text_updated');
      return reply(interaction, 'Texto del panel actualizado. Ejecuta `/ticket-panel` para publicar el cambio.');
    }
    if (sub === 'ia-global') {
      const active = interaction.options.getBoolean('activa', true);
      db.prepare('UPDATE guild_settings SET ai_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(Number(active), interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'guild_ai_toggled', active ? 'enabled' : 'disabled');
      return reply(interaction, `IA ${active ? 'activada' : 'pausada'} para el servidor.`);
    }
    if (sub === 'modo-ia') {
      const mode = interaction.options.getString('modo', true);
      db.prepare('UPDATE guild_settings SET ai_mode=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(mode, interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'guild_ai_mode', mode);
      return reply(interaction, `Modo de IA actualizado: **${mode === 'auto' ? 'automático' : 'bajo demanda'}**.`);
    }
    if (sub === 'duplicados') {
      const allow = interaction.options.getBoolean('permitir-otras-categorias', true);
      db.prepare('UPDATE guild_settings SET allow_same_category=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(Number(allow), interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'duplicate_policy_changed', allow ? 'one ticket per category' : 'one open ticket per user');
      return reply(interaction, allow ? 'Se permite un ticket abierto por categoría.' : 'Solo se permite un ticket abierto por persona.');
    }
    if (sub === 'categoria') {
      const key = interaction.options.getString('clave', true).toLowerCase();
      if (!cleanCategoryKey(key)) return reply(interaction, 'La clave debe contener solo letras minúsculas, números o guiones (máx. 32).');
      const existing = categoriesFor(settings).find(item => item.key === key) || {};
      const category = {
        ...existing,
        key,
        name: interaction.options.getString('nombre', true),
        question: interaction.options.getString('pregunta', true),
        discordCategoryId: interaction.options.getChannel('categoria-discord')?.id || existing.discordCategoryId || null,
        supportRoleId: interaction.options.getRole('rol-soporte')?.id || existing.supportRoleId || null
      };
      const categories = categoriesFor(settings).filter(item => item.key !== key);
      categories.push(category);
      db.prepare('UPDATE guild_settings SET categories=?,updated_at=CURRENT_TIMESTAMP WHERE guild_id=?').run(JSON.stringify(categories.slice(0, 25)), interaction.guildId);
      logGuildAction(interaction.guildId, interaction.user.id, 'ticket_category_updated', category.key);
      return reply(interaction, `Categoría **${category.name}** guardada. Publica de nuevo el panel con `/ticket-panel`.`);
    }
  }

  if (name === 'ticket-stats') {
    if (!hasManageGuild(interaction)) return reply(interaction, 'Necesitas permiso **Gestionar servidor**.');
    const stats = statements.stats.get(interaction.guildId);
    return reply(interaction, `**Estadísticas de tickets**\nTotal: ${stats.total}\nAbiertos: ${stats.open || 0}\nCerrados: ${stats.closed || 0}\nValoración media: ${stats.avg_rating ? `${Number(stats.avg_rating).toFixed(1)}/5` : 'sin valoraciones'}`);
  }

  if (name === 'ticket-blacklist') {
    if (!hasManageGuild(interaction)) return reply(interaction, 'Necesitas permiso **Gestionar servidor**.');
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('usuario', true);
    if (sub === 'agregar') {
      const reason = interaction.options.getString('motivo') || '';
      statements.blacklistAdd.run(interaction.guildId, user.id, reason, interaction.user.id);
      logGuildAction(interaction.guildId, interaction.user.id, 'blacklist_added', `User ${user.id}; reason: ${reason || 'unspecified'}`);
      return reply(interaction, `${user.tag} ya no puede abrir tickets. Motivo: ${reason || 'no especificado'}`);
    }
    statements.blacklistRemove.run(interaction.guildId, user.id);
    logGuildAction(interaction.guildId, interaction.user.id, 'blacklist_removed', `User ${user.id}`);
    return reply(interaction, `Se retiró a ${user.tag} de la lista de bloqueo.`);
  }

  if (name === 'ticket-add' || name === 'ticket-remove') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const user = interaction.options.getUser('usuario', true);
    if (name === 'ticket-add') {
      await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
      statements.addParticipant.run(ticket.id, user.id);
      logEvent(ticket.id, interaction.user.id, 'user_added', user.id);
      return reply(interaction, `Añadí a <@${user.id}> al ticket.`);
    }
    if (user.id === ticket.owner_id) return reply(interaction, 'No puedes retirar a quien abrió el ticket.');
    await interaction.channel.permissionOverwrites.delete(user.id);
    statements.removeParticipant.run(ticket.id, user.id);
    logEvent(ticket.id, interaction.user.id, 'user_removed', user.id);
    return reply(interaction, `Retiré a <@${user.id}> del ticket.`);
  }

  if (name === 'ticket-claim') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const action = interaction.options.getString('accion', true);
    if (action === 'claim' && ticket.claimed_by && ticket.claimed_by !== interaction.user.id) return reply(interaction, `Este ticket ya lo tiene <@${ticket.claimed_by}>.`);
    const assignee = action === 'claim' ? interaction.user.id : null;
    statements.updateClaim.run(assignee, ticket.id);
    logEvent(ticket.id, interaction.user.id, action === 'claim' ? 'claimed' : 'released');
    return reply(interaction, action === 'claim' ? `Ticket asignado a <@${interaction.user.id}>.` : 'Ticket liberado para el equipo.');
  }

  if (name === 'ticket-close') {
    const settings = settingsFor(interaction);
    if (!staff(interaction) && ticket.owner_id !== interaction.user.id) return reply(interaction, 'Solo quien abrió el ticket o el equipo de soporte puede cerrarlo.');
    return interaction.reply({ content: '¿Quieres cerrar este ticket y guardar la transcripción?', components: [actionRowsCloseConfirm()], ephemeral: true });
  }

  if (name === 'ticket-reopen') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    if (ticket.status !== 'closed') return reply(interaction, 'Este ticket ya está abierto.');
    statements.reopenTicket.run(ticket.id);
    for (const { user_id: userId } of statements.participants.all(ticket.id)) {
      await interaction.channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => {});
    }
    await interaction.channel.permissionOverwrites.edit(ticket.owner_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, '').slice(0, 100));
    logEvent(ticket.id, interaction.user.id, 'reopened');
    return reply(interaction, `Ticket #${ticket.id} reabierto.`);
  }

  if (name === 'ticket-priority') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const value = interaction.options.getString('nivel', true);
    statements.updatePriority.run(value, ticket.id);
    logEvent(ticket.id, interaction.user.id, 'priority_changed', value);
    return reply(interaction, `Prioridad cambiada a **${priorities[value]}**.`);
  }

  if (name === 'ticket-transfer') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const key = interaction.options.getString('categoria', true).toLowerCase();
    const settings = settingsFor(interaction);
    const category = categoriesFor(settings).find(item => item.key === key);
    if (!category) return reply(interaction, 'No encuentro esa categoría. Consulta `/ticket-config ver`.');
    const targetRoleId = category.supportRoleId || settings.support_role_id;
    const targetParentId = category.discordCategoryId || settings.default_category_id;
    const newRole = targetRoleId && await interaction.guild.roles.fetch(targetRoleId).catch(() => null);
    const newParent = targetParentId && await interaction.guild.channels.fetch(targetParentId).catch(() => null);
    if (!newRole || !newParent || newParent.type !== ChannelType.GuildCategory) return reply(interaction, 'La categoría de Discord o el rol de soporte configurado ya no existe.');
    if (targetParentId !== interaction.channel.parentId) await interaction.channel.setParent(targetParentId, { lockPermissions: false });
    if (ticket.support_role_id && ticket.support_role_id !== targetRoleId && ticket.support_role_id !== settings.support_role_id) {
      await interaction.channel.permissionOverwrites.delete(ticket.support_role_id).catch(() => {});
    }
    await interaction.channel.permissionOverwrites.edit(targetRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    db.prepare('UPDATE tickets SET category_key=?,category_label=?,support_role_id=? WHERE id=?').run(category.key, category.name, targetRoleId, ticket.id);
    await interaction.channel.setTopic(`modeos-ticket;owner=${ticket.owner_id};category=${category.key}`);
    logEvent(ticket.id, interaction.user.id, 'transferred', category.name);
    logGuildAction(interaction.guildId, interaction.user.id, 'ticket_transferred', `Ticket ${ticket.id} a categoría ${category.key}.`);
    return reply(interaction, `Ticket transferido a **${category.name}** y su equipo de soporte.`);
  }

  if (name === 'ticket-info') {
    if (!staff(interaction) && ticket.owner_id !== interaction.user.id) return reply(interaction, 'No tienes acceso a este ticket.');
    if (!staff(interaction)) return reply(interaction, `**Ticket #${ticket.id}**\nCategoría: ${ticket.category_label}\nEstado: ${ticket.status}\nPrioridad: ${priorities[ticket.priority]}\nAbierto: ${ticket.opened_at}`);
    const notes = statements.notes.all(ticket.id).map(n => `• ${n.note} — <@${n.author_id}>`).join('\n') || 'Sin notas internas.';
    const events = statements.events.all(ticket.id).slice(0, 8).map(e => `• ${e.action}: ${e.details || '—'} (${e.created_at})`).join('\n') || 'Sin actividad.';
    return reply(interaction, `**Ticket #${ticket.id}**\nSolicitante: <@${ticket.owner_id}>\nCategoría: ${ticket.category_label}\nEstado: ${ticket.status}\nPrioridad: ${priorities[ticket.priority]}\nAgente: ${ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'sin asignar'}\nAbierto: ${ticket.opened_at}\n\n**Notas internas**\n${notes}\n\n**Actividad reciente**\n${events}`);
  }

  if (name === 'ticket-note') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const note = interaction.options.getString('texto', true).trim();
    statements.addNote.run(ticket.id, interaction.user.id, note);
    logEvent(ticket.id, interaction.user.id, 'internal_note', 'Nota interna añadida.');
    return reply(interaction, 'Nota interna guardada. Solo el equipo de soporte puede verla.');
  }

  if (name === 'ticket-summary') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const aiSettings = settingsFor(interaction);
    if (!config.aiGlobalEnabled || !aiSettings.ai_enabled || !ticket.ai_enabled) return reply(interaction, 'La IA está pausada globalmente, en el servidor o en este ticket.');
    if (!config.aiApiKey) return reply(interaction, 'Configura AI_API_KEY para generar resúmenes con IA.');
    if (statements.usageCountUser.get(interaction.user.id).count >= config.aiRequestsPerUserHour || statements.usageCountTicket.get(ticket.id).count >= config.aiRequestsPerTicketHour) return reply(interaction, 'Se alcanzó el límite temporal de solicitudes de IA.');
    statements.addUsage.run(ticket.guild_id, ticket.id, interaction.user.id);
    await interaction.deferReply({ ephemeral: true });
    try {
      const messages = await interaction.channel.messages.fetch({ limit: config.historyLimit });
      const recent = [...messages.values()].reverse().filter(m => m.content).map(m => `${m.author.username}: ${m.content}`).join('\n');
      const transcript = `Formulario de apertura: ${ticket.initial_message || 'sin texto'}\n${recent}`;
      const summary = await askModel({
        instructions: 'Eres un asistente interno de soporte. Resume en español el problema, datos confirmados, pasos intentados, resultado y siguiente acción sugerida. No inventes datos. No incluyas secretos ni datos irrelevantes.',
        input: [{ role: 'user', content: transcript.slice(-12000) || 'No hay mensajes de texto.' }]
      });
      logEvent(ticket.id, interaction.user.id, 'summary_generated', 'Resumen de relevo.');
      return interaction.editReply(`**Resumen interno de relevo:**\n${summary}`);
    } catch (error) { return interaction.editReply(aiErrorMessage(error)); }
  }

  if (name === 'ticket-transcript') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    await interaction.deferReply({ ephemeral: true });
    const transcript = await buildTranscript(interaction.channel, ticket);
    logEvent(ticket.id, interaction.user.id, 'transcript_generated', 'Transcripción bajo demanda.');
    return interaction.editReply({ content: 'Transcripción generada. Solo tú puedes verla aquí.', files: transcript.files });
  }

  if (name === 'ticket-ia') {
    if (!staff(interaction)) return reply(interaction, staffOnlyMessage);
    const sub = interaction.options.getSubcommand();
    if (sub === 'sugerir') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const suggestion = await answerTicket(interaction.channel, ticket, settingsFor(interaction), interaction.user.id, { force: true, draft: true });
        return interaction.editReply(`**Borrador de IA (no enviado al usuario):**\n${suggestion}`);
      } catch (error) { return interaction.editReply(aiErrorMessage(error)); }
    }
    if (sub === 'modo') {
      const mode = interaction.options.getString('modo', true);
      statements.updateAi.run(1, mode, ticket.id);
      logEvent(ticket.id, interaction.user.id, 'ai_mode_changed', mode);
      return reply(interaction, `IA del ticket configurada en modo **${mode === 'auto' ? 'automático' : 'bajo demanda'}**.`);
    }
    const enabled = sub === 'activar';
    if (enabled && (!config.aiGlobalEnabled || !settingsFor(interaction).ai_enabled)) return reply(interaction, 'No puedo activar la IA en este ticket porque está pausada globalmente o en el servidor.');
    statements.updateAi.run(Number(enabled), ticket.ai_mode, ticket.id);
    logEvent(ticket.id, interaction.user.id, enabled ? 'ai_enabled' : 'ai_paused');
    return reply(interaction, `IA ${enabled ? 'activada' : 'pausada'} para este ticket.`);
  }
}

async function handleSelect(interaction) {
  if (interaction.customId !== 'ticket:category') return false;
  const settings = settingsFor(interaction);
  const category = categoriesFor(settings).find(c => c.key === interaction.values[0]);
  if (!category) { await reply(interaction, 'Esta categoría ya no existe. Avisa a un administrador para que actualice el panel.'); return true; }
  if (statements.blacklistGet.get(interaction.guildId, interaction.user.id)) { await reply(interaction, 'No puedes abrir tickets en este servidor. Contacta con la administración si crees que es un error.'); return true; }
  const open = statements.openTickets.all(interaction.guildId, interaction.user.id);
  if (settings.allow_same_category ? statements.openSameCategory.get(interaction.guildId, interaction.user.id, category.key) : open.length) {
    await reply(interaction, 'Ya tienes un ticket abierto que cumple la regla de duplicados del servidor.'); return true;
  }
  if (!(category.supportRoleId || settings.support_role_id) || !(category.discordCategoryId || settings.default_category_id)) { await reply(interaction, 'Esta categoría aún no tiene un rol o categoría de Discord configurados. Contacta con administración.'); return true; }
  await interaction.showModal(buildIntakeModal(category, settings));
  return true;
}

async function handleModal(interaction) {
  if (!interaction.customId.startsWith('ticket:create:')) return false;
  const settings = settingsFor(interaction);
  const key = interaction.customId.split(':')[2];
  const category = categoriesFor(settings).find(c => c.key === key);
  if (!category) { await reply(interaction, 'La categoría ya no está disponible.'); return true; }
  await interaction.deferReply({ ephemeral: true });
  const form = { problem: interaction.fields.getTextInputValue('problem').slice(0, 1500), details: interaction.fields.getTextInputValue('details').slice(0, 1000) };
  try {
    const channel = await createTicket(interaction, category, form);
    await interaction.editReply(`Tu ticket está listo: ${channel}`);
  } catch (error) {
    const message = error.message === 'ALREADY_OPEN' || error.message === 'DUPLICATE_CATEGORY'
      ? 'Ya tienes abierto un ticket que cumple la regla del servidor.'
      : error.message === 'BLACKLISTED' ? 'No puedes abrir tickets en este servidor.'
        : error.message === 'SETUP_INCOMPLETE' ? 'Falta configurar el rol de soporte o la categoría. Avisa a administración.'
          : 'No pude crear el ticket. Comprueba los permisos del bot e inténtalo de nuevo.';
    await interaction.editReply(message);
  }
  return true;
}

async function finalizeClose(interaction, ticket, settings) {
  await interaction.deferUpdate();
  let transcript;
  try {
    transcript = await buildTranscript(interaction.channel, ticket);
    const closed = statements.closeTicket.run(interaction.user.id, transcript.htmlPath, ticket.id);
    if (!closed.changes) {
      await interaction.followUp({ content: 'Otro agente ya cerró este ticket.', ephemeral: true });
      return;
    }
    logEvent(ticket.id, interaction.user.id, 'closed', 'Ticket cerrado.');
    for (const { user_id: userId } of statements.participants.all(ticket.id)) {
      await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
    }
    await interaction.channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: false });
    await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100));
    const ratingButtons = new ActionRowBuilder().addComponents([1,2,3,4,5].map(n => new ButtonBuilder().setCustomId(`ticket:rate:${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)));
    await interaction.channel.send({ content: `Ticket cerrado por <@${interaction.user.id}>. Si quieres, valora la atención (1–5). El personal puede reabrirlo con `/ticket-reopen`.`, components: [ratingButtons] });
    let logState = 'No había canal de registros configurado.';
    if (settings.logs_channel_id) {
      const logs = await interaction.guild.channels.fetch(settings.logs_channel_id).catch(() => null);
      if (logs?.isTextBased()) {
        try {
          await logs.send({ content: `**Ticket #${ticket.id} cerrado** · <#${ticket.channel_id}> · Solicitante <@${ticket.owner_id}> · Cerrado por <@${interaction.user.id}>`, files: transcript.files });
          logState = 'Transcripción enviada al canal de registros.';
        } catch (error) {
          console.error('No se pudo enviar la transcripción a logs:', error.message);
          logState = 'No pude enviarla a logs; quedó guardada localmente.';
        }
      }
    }
    await interaction.followUp({ content: `Ticket cerrado. ${logState}`, ephemeral: true });
  } catch (error) {
    console.error('Error cerrando ticket:', error.message);
    await interaction.followUp({ content: 'No pude completar el cierre. Comprueba permisos y canal de registros.', ephemeral: true }).catch(() => {});
  }
}

async function handleButton(interaction) {
  if (!interaction.customId.startsWith('ticket:')) return false;
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ticket = currentTicket(interaction);
  if (!ticket) { await reply(interaction, 'Este canal no está registrado como ticket.'); return true; }
  const settings = settingsFor(interaction);
  if (ticket.status === 'closed' && action !== 'rate') { await reply(interaction, 'Este ticket está cerrado. El personal puede reabrirlo con `/ticket-reopen`.'); return true; }
  if (action === 'close') {
    if (!staff(interaction) && ticket.owner_id !== interaction.user.id) { await reply(interaction, 'Solo quien abrió el ticket o el personal puede cerrarlo.'); return true; }
    await interaction.reply({ content: 'El cierre generará una transcripción y bloqueará nuevos mensajes del solicitante.', components: [actionRowsCloseConfirm()], ephemeral: true });
    return true;
  }
  if (action === 'close-confirm') {
    if (!staff(interaction) && ticket.owner_id !== interaction.user.id) { await reply(interaction, 'No tienes permiso para cerrar este ticket.'); return true; }
    await finalizeClose(interaction, ticket, settings);
    return true;
  }
  if (action === 'close-cancel') { await updateResponse(interaction, 'Cierre cancelado.'); return true; }
  if (action === 'claim') {
    if (!staff(interaction)) { await reply(interaction, staffOnlyMessage); return true; }
    if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) { await reply(interaction, `Ya está reclamado por <@${ticket.claimed_by}>.`); return true; }
    statements.updateClaim.run(interaction.user.id, ticket.id);
    logEvent(ticket.id, interaction.user.id, 'claimed');
    await reply(interaction, `Ticket reclamado por <@${interaction.user.id}>.`);
    return true;
  }
  if (action === 'human') {
    logEvent(ticket.id, interaction.user.id, 'human_requested');
    const ticketRoleId = ticket.support_role_id || settings.support_role_id;
    const text = ticketRoleId ? `<@&${ticketRoleId}>: <@${interaction.user.id}> solicita que intervenga una persona.` : 'El usuario solicita atención humana.';
    await interaction.channel.send({ content: text, allowedMentions: { users: [interaction.user.id], roles: ticketRoleId ? [ticketRoleId] : [] } });
    await reply(interaction, 'He avisado al equipo. Un miembro de soporte te atenderá cuando esté disponible.');
    return true;
  }
  if (action === 'ai') {
    if (!staff(interaction)) { await reply(interaction, staffOnlyMessage); return true; }
    const enabled = !ticket.ai_enabled;
    if (enabled && (!config.aiGlobalEnabled || !settings.ai_enabled)) { await reply(interaction, 'La IA está pausada globalmente o en el servidor.'); return true; }
    statements.updateAi.run(Number(enabled), ticket.ai_mode, ticket.id);
    logEvent(ticket.id, interaction.user.id, enabled ? 'ai_enabled' : 'ai_paused');
    await reply(interaction, `IA ${enabled ? 'activada' : 'pausada'} para este ticket.`);
    return true;
  }
  if (action === 'ask-ai') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const answer = await answerTicket(interaction.channel, ticket, settings, interaction.user.id, { force: true, excludeCurrent: false });
      await interaction.channel.send({ content: answer, allowedMentions: { parse: [] } });
      await interaction.editReply('La respuesta del asistente virtual se publicó en el ticket.');
    } catch (error) { await interaction.editReply(aiErrorMessage(error)); }
    return true;
  }
  if (action === 'rate') {
    if (ticket.owner_id !== interaction.user.id) { await reply(interaction, 'Solo quien abrió el ticket puede valorar la atención.'); return true; }
    const rating = Number(parts[2]);
    if (rating < 1 || rating > 5) { await reply(interaction, 'Valoración no válida.'); return true; }
    statements.rating.run(rating, '', ticket.id);
    interaction.message.edit({ components: [] }).catch(() => {});
    logEvent(ticket.id, interaction.user.id, 'rated', String(rating));
    await updateResponse(interaction, `Gracias por valorar la atención con ${rating}/5.`);
    return true;
  }
  return true;
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) await runCommand(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelect(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
  } catch (error) {
    console.error('Error atendiendo interacción:', error.message);
    const message = 'Se produjo un error al procesar la acción. El bot lo ha registrado sin mostrar datos sensibles.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await reply(interaction, message).catch(() => {});
  }
}

function aiErrorMessage(error) {
  if (error.message === 'AI_NOT_CONFIGURED') return 'La IA no está configurada. El ticket sigue disponible para el equipo humano.';
  if (error.message === 'AI_PAUSED') return 'La IA está pausada globalmente o en este ticket.';
  if (error.message === 'AI_MANUAL_MODE') return 'La IA está en modo bajo demanda; este botón permite consultarla.';
  if (error.message === 'AI_LIMIT') return 'Se alcanzó el límite temporal de solicitudes. Inténtalo más tarde.';
  if (error.message === 'AI_RATE_LIMIT') return 'El proveedor está limitando solicitudes. Prueba más tarde.';
  return 'No se pudo obtener una respuesta de IA. El equipo puede continuar con el ticket.';
}

module.exports = { handleInteraction, aiErrorMessage };
