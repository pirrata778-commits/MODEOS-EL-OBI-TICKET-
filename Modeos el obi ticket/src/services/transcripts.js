const { AttachmentBuilder } = require('discord.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeName(value) { return value.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80); }

async function buildTranscript(channel, ticket) {
  const all = [];
  let before;
  while (all.length < 5000) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    all.push(...page.values());
    before = page.last().id;
    if (page.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const htmlMessages = all.map(message => {
    const attachments = [...message.attachments.values()].map(file =>
      `<li>${escapeHtml(file.name || 'archivo')} (${escapeHtml(file.contentType || 'tipo desconocido')}) — <a href="${escapeHtml(file.url)}">abrir en Discord</a></li>`).join('');
    const embeds = message.embeds.map(embed => [embed.title, embed.description, ...embed.fields.map(field => `${field.name}: ${field.value}`)].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
    const body = escapeHtml([message.content, embeds].filter(Boolean).join('\n\n')).replace(/\n/g, '<br>');
    return `<article><header><b>${escapeHtml(message.author.tag)}</b> <time>${new Date(message.createdTimestamp).toISOString()}</time></header><p>${body || '<i>(sin texto)</i>'}</p>${attachments ? `<ul>${attachments}</ul>` : ''}</article>`;
  }).join('\n');
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ticket ${ticket.id}</title><style>body{font:15px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}article{border-bottom:1px solid #ddd;padding:1rem 0}time{color:#666;font-size:.85em;margin-left:1rem}p{overflow-wrap:anywhere}a{color:#5865f2}</style><h1>MODEOS EL OBI · ${escapeHtml(channel.name)}</h1><p>Abierto por ${escapeHtml(ticket.owner_id)} · Categoría ${escapeHtml(ticket.category_label)} · Estado ${escapeHtml(ticket.status)}</p>${htmlMessages}</html>`;
  const text = all.map(message => {
    const embeds = message.embeds.map(embed => [embed.title, embed.description, ...embed.fields.map(field => `${field.name}: ${field.value}`)].filter(Boolean).join('\n')).filter(Boolean).join('\n');
    return `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag}: ${[message.content, embeds].filter(Boolean).join('\n') || '(sin texto)'}${message.attachments.size ? ` | Adjuntos: ${[...message.attachments.values()].map(a => `${a.name || 'archivo'} (${a.url})`).join(', ')}` : ''}`;
  }).join('\n');
  const directory = path.resolve('./data/transcripts');
  await fs.mkdir(directory, { recursive: true });
  const base = `${safeName(channel.name)}-${ticket.id}`;
  const htmlPath = path.join(directory, `${base}.html`);
  await fs.writeFile(htmlPath, html, 'utf8');
  await fs.writeFile(path.join(directory, `${base}.txt`), text, 'utf8');
  return { htmlPath, files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${base}.html` }), new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${base}.txt` })] };
}

module.exports = { buildTranscript };
