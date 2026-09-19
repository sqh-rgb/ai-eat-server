const fs = require('node:fs');
const path = require('node:path');

const PROJECT_URL = 'https://trjctzubbppgblnjlycs.supabase.co';
const EMAIL_REDIRECT_URL = 'http://localhost:5173/auth/callback';
const PASSWORD_RESET_REDIRECT_URL = 'http://localhost:5173/auth/reset-password';

function validateKey(value, prefix, label) {
  const key = String(value || '').trim();
  const pattern = new RegExp(`^${prefix}[A-Za-z0-9_-]{12,}$`);
  if (!pattern.test(key)) {
    throw new Error(`${label} key must start with ${prefix}.`);
  }
  if (key.includes('"') || /[\r\n]/.test(key)) {
    throw new Error(`${label} key contains unsupported characters.`);
  }
  return key;
}

function renderEnvironment(publishableKey, secretKey) {
  return [
    `SUPABASE_URL="${PROJECT_URL}"`,
    `SUPABASE_PUBLISHABLE_KEY="${publishableKey}"`,
    `SUPABASE_SERVICE_ROLE_KEY="${secretKey}"`,
    `AUTH_EMAIL_REDIRECT_URL="${EMAIL_REDIRECT_URL}"`,
    `AUTH_PASSWORD_RESET_REDIRECT_URL="${PASSWORD_RESET_REDIRECT_URL}"`,
    '',
  ].join('\n');
}

function configure(environment = process.env) {
  const publishableKey = validateKey(
    environment.AI_EAT_SUPABASE_PUBLISHABLE_KEY,
    'sb_publishable_',
    'Publishable',
  );
  const secretKey = validateKey(
    environment.AI_EAT_SUPABASE_SECRET_KEY,
    'sb_secret_',
    'Secret',
  );
  const environmentFile = path.resolve(
    environment.AI_EAT_AUTH_ENV_FILE || path.join(__dirname, '..', '.env.auth.local'),
  );

  fs.mkdirSync(path.dirname(environmentFile), { recursive: true });
  fs.writeFileSync(environmentFile, renderEnvironment(publishableKey, secretKey), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

if (require.main === module) {
  try {
    configure();
    console.log('Local Supabase authentication configuration saved.');
    console.log('API keys were not displayed. .env.auth.local is ignored by Git.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { configure, renderEnvironment, validateKey };
