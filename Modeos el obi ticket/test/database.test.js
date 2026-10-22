const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modeos-tickets-'));
process.env.DATABASE_PATH = path.join(directory, 'tickets.sqlite');
const { db, statements, ensureSettings, logEvent } = require('../src/database');

test('separa configuración y tickets por servidor y conserva los datos en SQLite', t => {
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const guildA = ensureSettings('guild-a');
  const guildB = ensureSettings('guild-b');
  assert.equal(guildA.guild_id, 'guild-a');
  assert.equal(guildB.guild_id, 'guild-b');
  db.prepare('UPDATE guild_settings SET server_description=? WHERE guild_id=?').run('Comunidad A', 'guild-a');
  assert.equal(statements.getSettings.get('guild-b').server_description, '');

  statements.createTicket.run('guild-a', 'channel-a', 'user-a', 'soporte', 'Soporte general', 1, 'auto', 'No me funciona el bot.', 'role-a');
  const ticket = statements.getTicket.get('channel-a');
  assert.equal(ticket.owner_id, 'user-a');
  assert.equal(ticket.initial_message, 'No me funciona el bot.');
  logEvent(ticket.id, 'agent-a', 'claimed', '');
  statements.addNote.run(ticket.id, 'agent-a', 'Nota interna');
  assert.equal(statements.notes.get(ticket.id).note, 'Nota interna');
  assert.equal(statements.openTickets.all('guild-a', 'user-a').length, 1);
  assert.equal(statements.openTickets.all('guild-b', 'user-a').length, 0);

  const reservation = db.prepare('INSERT INTO ticket_reservations(guild_id,owner_id,category_key) VALUES (?,?,?)');
  reservation.run('guild-a', 'user-a', '*');
  assert.throws(() => reservation.run('guild-a', 'user-a', '*'), /UNIQUE|PRIMARY KEY/i);
  db.prepare('DELETE FROM ticket_reservations WHERE guild_id=? AND owner_id=?').run('guild-a', 'user-a');

  db.close();
  const reopened = new (require('better-sqlite3'))(process.env.DATABASE_PATH);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1);
  reopened.close();
});
