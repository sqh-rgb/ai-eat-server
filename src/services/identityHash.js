const crypto = require('node:crypto');

function secret() {
  const configured = String(process.env.IDENTITY_HASH_SECRET || '').trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === 'production') {
    const error = new Error('IDENTITY_HASH_SECRET 尚未安全配置');
    error.code = 'IDENTITY_HASH_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return 'ai-eat-development-only-identity-secret';
}

function hashIdentity(value, purpose = 'user') {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return crypto.createHmac('sha256', secret()).update(`${purpose}:${normalized}`).digest('hex');
}

module.exports = { hashIdentity };
