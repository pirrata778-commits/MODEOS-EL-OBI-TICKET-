const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

const dbPath = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
 guild_id TEXT PRIMARY KEY, panel_channel_id TEXT, support_role_id TEXT, logs_channel_id TEXT,
 default_category_id TEXT, assistant_name TEXT NOT NULL DEFAULT 'Modeos el Obi',
 panel_title TEXT NOT NULL DEFAULT 'MODEOS EL OBI · Centro de soporte',
 panel_description TEXT NOT NULL DEFAULT 'Selecciona el motivo de tu consulta para abrir un ticket privado.',
 welcome_text TEXT NOT NULL DEFAULT 'Cuéntanos qué necesitas. El asistente virtual y el equipo de soporte te ayudarán.',
 server_description TEXT NOT NULL DEFAULT '', intake_questions TEXT NOT NULL DEFAULT '[]',
 categories TEXT NOT NULL DEFAULT '[]', ai_enabled INTEGER NOT NULL DEFAULT 1,
 ai_mode TEXT NOT NULL DEFAULT 'auto', allow_same_category INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL UNIQUE,
 owner_id TEXT NOT NULL, category_key TEXT NOT NULL, category_label TEXT NOT NULL, support_role_id TEXT,
 status TEXT NOT NULL DEFAULT 'open', claimed_by TEXT, priority TEXT NOT NULL DEFAULT 'normal',
 ai_enabled INTEGER NOT NULL DEFAULT 1, ai_mode TEXT NOT NULL DEFAULT 'auto',
 initial_message TEXT NOT NULL DEFAULT '',
 opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at TEXT, closed_by TEXT,
 transcript_path TEXT, rating INTEGER, rating_comment TEXT
);
CREATE INDEX IF NOT EXISTS tickets_guild_owner_status ON tickets(guild_id, owner_id, status);
CREATE TABLE IF NOT EXISTS ticket_reservations (
 guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, category_key TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(guild_id, owner_id, category_key)
);
CREATE TABLE IF NOT EXISTS ticket_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id),
 actor_id TEXT, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ticket_notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id),
 author_id TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ticket_participants (
 ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id TEXT NOT NULL,
 PRIMARY KEY(ticket_id,user_id)
);
CREATE TABLE IF NOT EXISTS blacklist (
 guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS ai_usage (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, ticket_id INTEGER NOT NULL,
 user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS guild_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT,
 action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_usage_ticket_time ON ai_usage(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_user_time ON ai_usage(user_id, created_at);
`);

// Migración ligera desde la primera versión de este esquema.
const ticketColumns = db.pragma('table_info(tickets)');
if (!ticketColumns.some(column => column.name === 'initial_message')) {
  db.exec("ALTER TABLE tickets ADD COLUMN initial_message TEXT NOT NULL DEFAULT ''");
}
if (!ticketColumns.some(column => column.name === 'support_role_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN support_role_id TEXT');
}

const statements = {
  getSettings: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
  insertSettings: db.prepare(`INSERT OR IGNORE INTO guild_settings
    (guild_id, support_role_id, logs_channel_id, default_category_id) VALUES (?, ?, ?, ?)`),
  updateSetting: db.prepare('UPDATE guild_settings SET panel_channel_id=?, support_role_id=?, logs_channel_id=?, default_category_id=?, updated_at=CURRENT_TIMESTAMP WHERE guild_id=?'),
  createTicket: db.prepare(`INSERT INTO tickets (guild_id,channel_id,owner_id,category_key,category_label,ai_enabled,ai_mode,initial_message,support_role_id) VALUES (?,?,?,?,?,?,?,?,?)`),
  getTicket: db.prepare("SELECT * FROM tickets WHERE channel_id=? AND status IN ('open','closed')"),
  openTickets: db.prepare("SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND status='open'"),
  openSameCategory: db.prepare("SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND category_key=? AND status='open'"),
  event: db.prepare('INSERT INTO ticket_events(ticket_id,actor_id,action,details) VALUES (?,?,?,?)'),
  updateClaim: db.prepare('UPDATE tickets SET claimed_by=? WHERE id=?'),
  updatePriority: db.prepare('UPDATE tickets SET priority=? WHERE id=?'),
  updateAi: db.prepare('UPDATE tickets SET ai_enabled=?, ai_mode=? WHERE id=?'),
  closeTicket: db.prepare("UPDATE tickets SET status='closed',closed_at=CURRENT_TIMESTAMP,closed_by=?,transcript_path=? WHERE id=? AND status='open'"),
  reopenTicket: db.prepare("UPDATE tickets SET status='open',closed_at=NULL,closed_by=NULL WHERE id=? AND status='closed'"),
  usageCountUser: db.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id=? AND created_at >= datetime('now','-1 hour')"),
  usageCountTicket: db.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE ticket_id=? AND created_at >= datetime('now','-1 hour')"),
  addUsage: db.prepare('INSERT INTO ai_usage(guild_id,ticket_id,user_id) VALUES (?,?,?)'),
  addNote: db.prepare('INSERT INTO ticket_notes(ticket_id,author_id,note) VALUES (?,?,?)'),
  notes: db.prepare('SELECT * FROM ticket_notes WHERE ticket_id=? ORDER BY id DESC LIMIT 20'),
  addParticipant: db.prepare('INSERT OR IGNORE INTO ticket_participants(ticket_id,user_id) VALUES (?,?)'),
  removeParticipant: db.prepare('DELETE FROM ticket_participants WHERE ticket_id=? AND user_id=?'),
  participants: db.prepare('SELECT user_id FROM ticket_participants WHERE ticket_id=?'),
  events: db.prepare('SELECT * FROM ticket_events WHERE ticket_id=? ORDER BY id DESC LIMIT 50'),
  blacklistAdd: db.prepare('INSERT OR REPLACE INTO blacklist(guild_id,user_id,reason,created_by) VALUES (?,?,?,?)'),
  blacklistRemove: db.prepare('DELETE FROM blacklist WHERE guild_id=? AND user_id=?'),
  blacklistGet: db.prepare('SELECT * FROM blacklist WHERE guild_id=? AND user_id=?'),
  stats: db.prepare(`SELECT COUNT(*) AS total, SUM(status='open') AS open,
    SUM(status='closed') AS closed, AVG(rating) AS avg_rating FROM tickets WHERE guild_id=?`),
  rating: db.prepare('UPDATE tickets SET rating=?,rating_comment=? WHERE id=?')
};

function ensureSettings(guildId) {
  statements.insertSettings.run(guildId, config.defaultSupportRoleId || null, config.defaultLogsChannelId || null, config.defaultCategoryId || null);
  return statements.getSettings.get(guildId);
}
function logEvent(ticketId, actorId, action, details = '') { statements.event.run(ticketId, actorId || null, action, String(details).slice(0, 1000)); }
function logGuildAction(guildId, actorId, action, details = '') {
  db.prepare('INSERT INTO guild_audit(guild_id,actor_id,action,details) VALUES (?,?,?,?)').run(guildId, actorId || null, action, String(details).slice(0, 1000));
}
function parseSettings(row) {
  return { ...row, categories: JSON.parse(row.categories || '[]'), intakeQuestions: JSON.parse(row.intake_questions || '[]'), ai_enabled: Boolean(row.ai_enabled), allow_same_category: Boolean(row.allow_same_category) };
}

module.exports = { db, statements, ensureSettings, parseSettings, logEvent, logGuildAction };
