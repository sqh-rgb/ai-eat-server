const { Router } = require('express');
const {
  safeUser, signUpWithEmail, signInWithEmail, refreshEmailSession,
  confirmEmailOtp, resendSignupConfirmation, requestPasswordReset, signOutAccessToken, updatePassword,
} = require('../services/supabaseAuth');
const { requireAuth, authRateLimiter } = require('../middleware/auth');

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function emailValue(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validationError('请输入有效的邮箱地址');
  }
  return email;
}

function passwordValue(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8 || password.length > 72 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw validationError('密码长度必须为 8～72 个字符，且不能包含控制字符');
  }
  return password;
}

function confirmationCodeValue(value) {
  const code = String(value || '').trim();
  if (!/^\d{6}$/.test(code)) throw validationError('请输入 6 位数字验证码');
  return code;
}

router.post('/signup', authRateLimiter, async (req, res, next) => {
  try {
    const result = await signUpWithEmail({
      email: emailValue(req.body?.email), password: passwordValue(req.body?.password),
    });
    return res.status(201).json({
      user: result.user,
      session: result.session,
      confirmationRequired: !result.session,
      message: result.session ? '注册并登录成功' : '注册成功，请前往邮箱完成验证',
    });
  } catch (error) { return next(error); }
});

router.post('/confirm-email', authRateLimiter, async (req, res, next) => {
  try {
    return res.json(await confirmEmailOtp({
      email: emailValue(req.body?.email), code: confirmationCodeValue(req.body?.code),
    }));
  } catch (error) { return next(error); }
});

router.post('/resend-confirmation', authRateLimiter, async (req, res, next) => {
  try {
    await resendSignupConfirmation(emailValue(req.body?.email));
    return res.status(202).json({ message: '如果该邮箱已注册且尚未验证，将收到验证码' });
  } catch (error) { return next(error); }
});

router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const result = await signInWithEmail({
      email: emailValue(req.body?.email), password: passwordValue(req.body?.password),
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/refresh', authRateLimiter, async (req, res, next) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken || refreshToken.length > 4096) throw validationError('refreshToken 无效');
    return res.json(await refreshEmailSession(refreshToken));
  } catch (error) { return next(error); }
});

router.post('/password-reset', authRateLimiter, async (req, res, next) => {
  try {
    await requestPasswordReset(emailValue(req.body?.email));
    return res.status(202).json({ message: '如果该邮箱已注册，将收到密码重置邮件' });
  } catch (error) { return next(error); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await signOutAccessToken(req.authToken);
    return res.status(204).end();
  } catch (error) { return next(error); }
});

router.post('/password', requireAuth, authRateLimiter, async (req, res, next) => {
  try {
    await updatePassword(req.authToken, passwordValue(req.body?.password));
    return res.json({ message: '密码已更新' });
  } catch (error) { return next(error); }
});

module.exports = { router, emailValue, passwordValue, confirmationCodeValue };
