require('dotenv').config();

function positiveInt(name, fallback, max = 100000) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  applicationId: process.env.DISCORD_APPLICATION_ID || '',
  testGuildId: process.env.DISCORD_TEST_GUILD_ID || '',
  aiProvider: (process.env.AI_PROVIDER || 'openai').toLowerCase(),
  aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4.1-mini',
  aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  port: positiveInt('PORT', 3000, 65535),
  dbPath: process.env.DATABASE_PATH || './data/tickets.sqlite',
  aiGlobalEnabled: process.env.AI_ENABLED !== 'false',
  aiRequestsPerUserHour: positiveInt('AI_USER_LIMIT_PER_HOUR', 12, 1000),
  aiRequestsPerTicketHour: positiveInt('AI_TICKET_LIMIT_PER_HOUR', 30, 1000),
  aiTimeoutMs: positiveInt('AI_TIMEOUT_MS', 25000, 120000),
  historyLimit: positiveInt('AI_HISTORY_LIMIT', 16, 50),
  retentionDays: positiveInt('TRANSCRIPT_RETENTION_DAYS', 90, 3650),
  defaultSupportRoleId: process.env.DEFAULT_SUPPORT_ROLE_ID || '',
  defaultCategoryId: process.env.DEFAULT_TICKET_CATEGORY_ID || '',
  defaultLogsChannelId: process.env.DEFAULT_LOGS_CHANNEL_ID || ''
};
