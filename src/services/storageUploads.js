const crypto = require('node:crypto');
const db = require('../db/pool');
const { getUserAuthClient, getServiceAuthClient } = require('./supabaseAuth');

const BUCKET = 'ai-eat-review-submissions';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 5;
const MAX_DAILY_UPLOADS = 30;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
]);

function serviceError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validationError(message) {
  return serviceError(message, 'VALIDATION_ERROR', 400);
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
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

function createStorageUploads({
  database = db,
  getUserClient = getUserAuthClient,
  getServiceClient = getServiceAuthClient,
  randomUUID = crypto.randomUUID,
  clock = () => new Date(),
} = {}) {
  async function issueUpload({ userId, userSubjectHash, accessToken, input }) {
    const upload = validateUploadRequest(input);
    const id = randomUUID();
    const storageKey = `${userId}/${id}.${MIME_EXTENSIONS.get(upload.mimeType)}`;
    const expiresAt = new Date(clock().getTime() + 2 * 60 * 60 * 1000);
    await database.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai-eat-upload:${userId}`]);
      await client.query(
        "UPDATE user_upload_intents SET status='expired',updated_at=NOW() WHERE user_id=$1 AND status='issued' AND expires_at<=NOW()",
        [userId],
      );
      const quota = (await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('issued','uploaded'))::integer AS active_count,
           COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '24 hours')::integer AS daily_count
         FROM user_upload_intents WHERE user_id=$1`,
        [userId],
      )).rows[0];
      if (Number(quota.active_count) >= MAX_CONCURRENT_UPLOADS) {
        throw serviceError(`同时最多保留 ${MAX_CONCURRENT_UPLOADS} 个待处理上传`, 'UPLOAD_QUOTA_EXCEEDED', 429);
      }
      if (Number(quota.daily_count) >= MAX_DAILY_UPLOADS) {
        throw serviceError(`24 小时内最多申请 ${MAX_DAILY_UPLOADS} 次上传`, 'UPLOAD_QUOTA_EXCEEDED', 429);
      }
      await client.query(
        `INSERT INTO user_upload_intents(
          id,user_id,user_subject_hash,storage_key,media_kind,expected_mime_type,expected_byte_size,expires_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, userId, userSubjectHash, storageKey, upload.mediaKind, upload.mimeType, upload.byteSize, expiresAt],
      );
    });
    const storage = getUserClient(accessToken).storage.from(BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(storageKey, { upsert: false });
    if (error || !data) {
      await database.query("UPDATE user_upload_intents SET status='rejected',updated_at=NOW() WHERE id=$1", [id]);
      throw serviceError('暂时无法创建图片上传地址', 'STORAGE_UNAVAILABLE', 502);
    }
    return {
      id, bucket: BUCKET, storageKey, signedUrl: data.signedUrl,
      token: data.token, expiresAt: expiresAt.toISOString(),
      mimeType: upload.mimeType, byteSize: upload.byteSize, mediaKind: upload.mediaKind,
    };
  }

  async function ownedIntent(client, userId, intentId, { lock = false } = {}) {
    const result = await client.query(
      `SELECT * FROM user_upload_intents WHERE id=$1 AND user_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [intentId, userId],
    );
    if (!result.rows[0]) throw serviceError('上传任务不存在', 'NOT_FOUND', 404);
    return result.rows[0];
  }

  async function removeWithService(storageKey) {
    const storage = getServiceClient().storage.from(BUCKET);
    const { error } = await storage.remove([storageKey]);
    if (error) throw serviceError('图片删除失败，请稍后再试', 'STORAGE_UNAVAILABLE', 502);
  }

  async function confirmUpload({ userId, accessToken, intentId }) {
    const intent = await ownedIntent(database, userId, intentId);
    if (intent.status === 'uploaded' || intent.status === 'attached') return intent;
    if (intent.status !== 'issued' || new Date(intent.expires_at) <= clock()) {
      await database.query("UPDATE user_upload_intents SET status='expired',updated_at=NOW() WHERE id=$1 AND status='issued'", [intentId]);
      throw serviceError('上传地址已经过期，请重新申请', 'UPLOAD_EXPIRED', 409);
    }
    const storage = getUserClient(accessToken).storage.from(BUCKET);
    const { data, error: downloadError } = await storage.download(intent.storage_key);
    if (downloadError || !data) throw serviceError('尚未检测到上传文件', 'UPLOAD_NOT_FOUND', 409);
    const bytes = Buffer.from(await data.arrayBuffer());
    const detectedMime = detectImageMime(bytes);
    const expectedBytes = Number(intent.expected_byte_size);
    if (!detectedMime || detectedMime !== intent.expected_mime_type || bytes.length !== expectedBytes) {
      await removeWithService(intent.storage_key);
      await database.query(
        "UPDATE user_upload_intents SET status='rejected',actual_mime_type=$2,actual_byte_size=$3,updated_at=NOW() WHERE id=$1",
        [intentId, detectedMime, bytes.length],
      );
      throw serviceError('图片实际格式或大小与申请信息不一致，文件已拒绝', 'UPLOAD_MISMATCH', 400);
    }
    const result = await database.query(
      `UPDATE user_upload_intents SET status='uploaded',actual_mime_type=$2,actual_byte_size=$3,
         confirmed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='issued' RETURNING *`,
      [intentId, detectedMime, bytes.length],
    );
    return result.rows[0] || ownedIntent(database, userId, intentId);
  }

  async function createPreviewUrl({ userId, accessToken, intentId, allowAdmin = false }) {
    const result = allowAdmin
      ? await database.query('SELECT * FROM user_upload_intents WHERE id=$1', [intentId])
      : await database.query('SELECT * FROM user_upload_intents WHERE id=$1 AND user_id=$2', [intentId, userId]);
    const intent = result.rows[0];
    if (!intent || !['uploaded', 'attached'].includes(intent.status)) throw serviceError('可预览的图片不存在', 'NOT_FOUND', 404);
    const { data, error } = await getUserClient(accessToken).storage.from(BUCKET).createSignedUrl(intent.storage_key, 300);
    if (error || !data?.signedUrl) throw serviceError('暂时无法创建预览地址', 'STORAGE_UNAVAILABLE', 502);
    return { signedUrl: data.signedUrl, expiresIn: 300 };
  }

  async function deleteUpload({ userId, intentId }) {
    return database.withTransaction(async client => {
      const intent = await ownedIntent(client, userId, intentId, { lock: true });
      if (intent.status === 'attached') throw serviceError('图片已经附加到评价，需先撤回评价', 'UPLOAD_ATTACHED', 409);
      if (intent.status === 'deleted') return;
      await removeWithService(intent.storage_key);
      await client.query("UPDATE user_upload_intents SET status='deleted',updated_at=NOW() WHERE id=$1 AND user_id=$2", [intentId, userId]);
    });
  }

  return { issueUpload, confirmUpload, createPreviewUrl, deleteUpload };
}

const defaultUploads = createStorageUploads();

module.exports = {
  BUCKET, MAX_BYTES, MAX_CONCURRENT_UPLOADS, MAX_DAILY_UPLOADS,
  validateUploadRequest, detectImageMime, createStorageUploads,
  ...defaultUploads,
};
