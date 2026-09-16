const crypto = require('node:crypto');
const db = require('../db/pool');
const { getUserAuthClient } = require('./supabaseAuth');

const BUCKET = 'ai-eat-review-submissions';
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
]);

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function validateUploadRequest(input = {}) {
  const mimeType = String(input.mimeType || '').trim().toLowerCase();
  const mediaKind = String(input.mediaKind || '').trim();
  const byteSize = Number(input.byteSize);
  if (!MIME_EXTENSIONS.has(mimeType)) throw validationError('只允许 JPEG、PNG、WebP 或 GIF 图片');
  if (!['sticker', 'review_photo'].includes(mediaKind)) throw validationError('mediaKind 无效');
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_BYTES) throw validationError('图片大小必须在 1 字节到 10MB 之间');
  return { mimeType, mediaKind, byteSize };
}

function detectImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

async function issueUpload({ userId, userSubjectHash, accessToken, input }) {
  const upload = validateUploadRequest(input);
  const id = crypto.randomUUID();
  const storageKey = `${userId}/${id}.${MIME_EXTENSIONS.get(upload.mimeType)}`;
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO user_upload_intents(
      id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,expires_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, userId, userSubjectHash, storageKey, upload.mediaKind, upload.mimeType, upload.byteSize, expiresAt],
  );
  const storage = getUserAuthClient(accessToken).storage.from(BUCKET);
  const { data, error } = await storage.createSignedUploadUrl(storageKey, { upsert: false });
  if (error || !data) {
    await db.query("UPDATE user_upload_intents SET status='rejected',updated_at=NOW() WHERE id=$1", [id]);
    const failure = new Error('暂时无法创建图片上传地址');
    failure.code = 'STORAGE_UNAVAILABLE';
    failure.status = 502;
    throw failure;
  }
  return {
    id, bucket: BUCKET, storageKey, signedUrl: data.signedUrl,
    token: data.token, expiresAt: expiresAt.toISOString(),
    mimeType: upload.mimeType, byteSize: upload.byteSize, mediaKind: upload.mediaKind,
  };
}

async function ownedIntent(userId, intentId) {
  const result = await db.query('SELECT * FROM user_upload_intents WHERE id=$1 AND user_id=$2', [intentId, userId]);
  if (!result.rows[0]) {
    const error = new Error('上传任务不存在');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function confirmUpload({ userId, accessToken, intentId }) {
  const intent = await ownedIntent(userId, intentId);
  if (intent.status === 'uploaded' || intent.status === 'attached') return intent;
  if (intent.status !== 'issued' || new Date(intent.expires_at) < new Date()) {
    await db.query("UPDATE user_upload_intents SET status='expired',updated_at=NOW() WHERE id=$1 AND status='issued'", [intentId]);
    const error = new Error('上传地址已经过期，请重新申请');
    error.code = 'UPLOAD_EXPIRED';
    error.status = 409;
    throw error;
  }
  const storage = getUserAuthClient(accessToken).storage.from(BUCKET);
  const { data, error: downloadError } = await storage.download(intent.storage_key);
  if (downloadError || !data) {
    const error = new Error('尚未检测到上传文件');
    error.code = 'UPLOAD_NOT_FOUND';
    error.status = 409;
    throw error;
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const detectedMime = detectImageMime(bytes);
  const expectedBytes = Number(intent.expected_byte_size);
  if (!detectedMime || detectedMime !== intent.expected_mime_type || bytes.length !== expectedBytes) {
    await storage.remove([intent.storage_key]).catch(() => undefined);
    await db.query(
      "UPDATE user_upload_intents SET status='rejected',actual_mime_type=$2,actual_byte_size=$3,updated_at=NOW() WHERE id=$1",
      [intentId, detectedMime, bytes.length],
    );
    const error = new Error('图片实际格式或大小与申请信息不一致，文件已拒绝');
    error.code = 'UPLOAD_MISMATCH';
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `UPDATE user_upload_intents SET status='uploaded',actual_mime_type=$2,actual_byte_size=$3,
       confirmed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,
    [intentId, detectedMime, bytes.length],
  );
  return result.rows[0];
}

async function createPreviewUrl({ userId, accessToken, intentId, allowAdmin = false }) {
  const result = allowAdmin
    ? await db.query('SELECT * FROM user_upload_intents WHERE id=$1', [intentId])
    : await db.query('SELECT * FROM user_upload_intents WHERE id=$1 AND user_id=$2', [intentId, userId]);
  const intent = result.rows[0];
  if (!intent || !['uploaded', 'attached'].includes(intent.status)) {
    const error = new Error('可预览的图片不存在');
    error.code = 'NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const { data, error } = await getUserAuthClient(accessToken).storage.from(BUCKET)
    .createSignedUrl(intent.storage_key, 300);
  if (error || !data?.signedUrl) {
    const failure = new Error('暂时无法创建预览地址');
    failure.code = 'STORAGE_UNAVAILABLE';
    failure.status = 502;
    throw failure;
  }
  return { signedUrl: data.signedUrl, expiresIn: 300 };
}

async function deleteUpload({ userId, accessToken, intentId }) {
  const intent = await ownedIntent(userId, intentId);
  if (intent.status === 'attached') {
    const error = new Error('图片已经附加到评价，需先撤回评价');
    error.code = 'UPLOAD_ATTACHED';
    error.status = 409;
    throw error;
  }
  if (intent.status !== 'deleted') {
    const { error } = await getUserAuthClient(accessToken).storage.from(BUCKET).remove([intent.storage_key]);
    if (error && intent.status === 'uploaded') {
      const failure = new Error('图片删除失败，请稍后再试');
      failure.code = 'STORAGE_UNAVAILABLE';
      failure.status = 502;
      throw failure;
    }
    await db.query("UPDATE user_upload_intents SET status='deleted',updated_at=NOW() WHERE id=$1", [intentId]);
  }
}

module.exports = {
  BUCKET, MAX_BYTES, validateUploadRequest, detectImageMime,
  issueUpload, confirmUpload, createPreviewUrl, deleteUpload,
};
