const { createClient } = require('@supabase/supabase-js');
const path = require('node:path');
const dotenv = require('dotenv');

if (process.env.AI_EAT_SKIP_LOCAL_ENV !== 'true') {
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.auth.local'), quiet: true });
}

let client;

function configuration() {
  return {
    url: String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, ''),
    key: String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim(),
  };
}

function authConfigured() {
  const { url, key } = configuration();
  return Boolean(url && key);
}

function authConfigurationError() {
  const error = new Error('Supabase 邮箱认证尚未配置');
  error.code = 'AUTH_NOT_CONFIGURED';
  error.status = 503;
  return error;
}

function getAuthClient() {
  if (!authConfigured()) throw authConfigurationError();
  if (!client) {
    const { url, key } = configuration();
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function getUserAuthClient(accessToken) {
  if (!authConfigured()) throw authConfigurationError();
  const { url, key } = configuration();
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function getServiceAuthClient() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    const error = new Error('服务端存储凭证尚未配置');
    error.code = 'STORAGE_SERVICE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    createdAt: user.created_at || null,
  };
}

function safeSession(session) {
  if (!session) return null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: session.token_type,
    expiresAt: session.expires_at,
    expiresIn: session.expires_in,
  };
}

function normalizeAuthError(source, defaultMessage = '认证请求失败') {
  const error = new Error(defaultMessage);
  const message = String(source?.message || '').toLowerCase();
  const status = Number(source?.status || 0);
  if (status === 429) {
    error.code = 'AUTH_RATE_LIMITED';
    error.status = 429;
    error.message = '尝试次数过多，请稍后再试';
  } else if (message.includes('email not confirmed')) {
    error.code = 'EMAIL_NOT_CONFIRMED';
    error.status = 403;
    error.message = '邮箱尚未验证，请输入邮件中的验证码';
  } else if (message.includes('invalid login credentials')) {
    error.code = 'INVALID_CREDENTIALS';
    error.status = 401;
    error.message = '邮箱或密码不正确';
  } else {
    error.code = 'AUTH_REQUEST_FAILED';
    error.status = status >= 400 && status < 500 ? 400 : 502;
  }
  return error;
}

async function signUpWithEmail({ email, password }) {
  const redirectTo = String(process.env.AUTH_EMAIL_REDIRECT_URL || '').trim();
  const options = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
  const { data, error } = await getAuthClient().auth.signUp({ email, password, options });
  if (error) throw normalizeAuthError(error, '邮箱注册失败');
  return { user: safeUser(data.user), session: safeSession(data.session) };
}

async function confirmEmailOtp({ email, code }) {
  const { data, error } = await getAuthClient().auth.verifyOtp({
    email, token: code, type: 'email',
  });
  if (error) throw normalizeAuthError(error, '验证码无效或已过期');
  return { user: safeUser(data.user), session: safeSession(data.session) };
}

async function resendSignupConfirmation(email) {
  const { error } = await getAuthClient().auth.resend({ type: 'signup', email });
  if (error) throw normalizeAuthError(error, '验证码发送失败');
}

async function signInWithEmail({ email, password }) {
  const { data, error } = await getAuthClient().auth.signInWithPassword({ email, password });
  if (error) throw normalizeAuthError(error, '邮箱登录失败');
  return { user: safeUser(data.user), session: safeSession(data.session) };
}

async function refreshEmailSession(refreshToken) {
  const { data, error } = await getAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw normalizeAuthError(error, '登录状态刷新失败');
  return { user: safeUser(data.user), session: safeSession(data.session) };
}

async function requestPasswordReset(email) {
  const redirectTo = String(process.env.AUTH_PASSWORD_RESET_REDIRECT_URL || '').trim();
  const options = redirectTo ? { redirectTo } : undefined;
  const { error } = await getAuthClient().auth.resetPasswordForEmail(email, options);
  if (error) throw normalizeAuthError(error, '密码重置请求失败');
}

async function verifyAccessToken(accessToken) {
  const { data, error } = await getAuthClient().auth.getUser(accessToken);
  if (error || !data.user) {
    const normalized = normalizeAuthError(error, '登录状态无效或已经过期');
    normalized.code = 'INVALID_TOKEN';
    normalized.status = 401;
    normalized.message = '登录状态无效或已经过期';
    throw normalized;
  }
  return data.user;
}

async function signOutAccessToken(accessToken) {
  const { url, key } = configuration();
  if (!url || !key) throw authConfigurationError();
  const response = await fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 401) {
    throw normalizeAuthError({ status: response.status }, '退出登录失败');
  }
}

async function updatePassword(accessToken, password) {
  const { url, key } = configuration();
  if (!url || !key) throw authConfigurationError();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw normalizeAuthError({ status: response.status, message: payload.msg || payload.message }, '密码更新失败');
  }
}

module.exports = {
  authConfigured, getAuthClient, getUserAuthClient, getServiceAuthClient, safeUser, normalizeAuthError,
  signUpWithEmail, confirmEmailOtp, resendSignupConfirmation, signInWithEmail, refreshEmailSession,
  requestPasswordReset, verifyAccessToken, signOutAccessToken, updatePassword,
};
