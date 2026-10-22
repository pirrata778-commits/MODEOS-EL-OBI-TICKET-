const { REST, Routes } = require('discord.js');
const config = require('./config');
const commands = require('./commands');

if (!config.token || !config.applicationId) {
  console.error('Configura DISCORD_TOKEN y DISCORD_APPLICATION_ID en el archivo .env.');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(config.token);
(async () => {
  try {
    const route = config.testGuildId
      ? Routes.applicationGuildCommands(config.applicationId, config.testGuildId)
      : Routes.applicationCommands(config.applicationId);
    await rest.put(route, { body: commands });
    console.log(`Registrados ${commands.length} comandos ${config.testGuildId ? 'en el servidor de pruebas' : 'globalmente'}.`);
  } catch (error) {
    console.error('No se pudieron registrar los comandos:', error.message);
    process.exitCode = 1;
  }
})();
