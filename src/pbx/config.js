'use strict';

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  databaseUrl: process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || '',
  ami: {
    host: process.env.AMI_HOST || '127.0.0.1',
    port: envInt('AMI_PORT', 5038),
    user: process.env.AMI_USER || '',
    secret: process.env.AMI_SECRET || '',
  },
  pbxCmdSecret: process.env.PBX_CMD_SECRET || '',
  agiPort: envInt('AGI_PORT', 4573),
  cmdPort: envInt('CMD_PORT', 4575),
  cmdHost: process.env.CMD_HOST || '127.0.0.1',
  recordingsRoot: process.env.PBX_RECORDINGS_ROOT || '/var/lib/asgard-crm/recordings',
  ttsCacheDir: process.env.PBX_TTS_CACHE_DIR || '/var/lib/asgard-crm/tts-cache',
};

function amiConfigured() {
  return !!(config.ami.user && config.ami.secret);
}

module.exports = { config, amiConfigured, envInt };
