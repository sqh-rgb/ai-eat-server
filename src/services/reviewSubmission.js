const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_MEDIA_KINDS = new Set(['sticker', 'review_photo']);
const MAX_MEDIA_ITEMS = 9;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.status = 400;
  return error;
}

function normalizeOptionalRating(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) throw validationError('rating 必须是 1～5 的整数');
  return value;
}

function normalizeMedia(media) {
  if (media === undefined || media === null) return [];
  if (!Array.isArray(media) || media.length > MAX_MEDIA_ITEMS) {
    throw validationError(`media 必须是最多 ${MAX_MEDIA_ITEMS} 项的数组`);
  }
  return media.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw validationError(`第 ${index + 1} 个媒体项格式错误`);
    const mediaKind = String(item.mediaKind || '').trim();
    const storageKey = String(item.storageKey || '').trim();
    const mimeType = String(item.mimeType || '').trim().toLowerCase();
    const byteSize = Number(item.byteSize);
    if (!ALLOWED_MEDIA_KINDS.has(mediaKind)) throw validationError(`第 ${index + 1} 个媒体类型不受支持`);
    if (!storageKey || storageKey.length > 500 || /^(?:https?:|data:|file:)/i.test(storageKey)) {
      throw validationError(`第 ${index + 1} 个媒体必须使用已上传的安全 storageKey`);
    }
    if (!ALLOWED_MEDIA_TYPES.has(mimeType)) throw validationError(`第 ${index + 1} 个媒体格式不受支持`);
    if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_MEDIA_BYTES) {
      throw validationError(`第 ${index + 1} 个媒体大小必须在 1 字节到 10MB 之间`);
    }
    const dimension = (value, name) => {
      if (value === undefined || value === null) return null;
      if (!Number.isInteger(value) || value < 1 || value > 12000) throw validationError(`第 ${index + 1} 个媒体${name}无效`);
      return value;
    };
    return {
      mediaKind,
      storageKey,
      mimeType,
      byteSize,
      width: dimension(item.width, '宽度'),
      height: dimension(item.height, '高度'),
      rightsConfirmed: item.rightsConfirmed === true,
    };
  });
}

function validateReviewSubmission(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const branchId = String(body.branchId || '').trim();
  const dishId = String(body.dishId || '').trim() || null;
  const publicText = String(body.publicText || '').trim();
  const rating = normalizeOptionalRating(body.rating);
  if (!branchId || branchId.length > 200) throw validationError('branchId 不能为空且不能超过 200 字符');
  if (dishId && dishId.length > 200) throw validationError('dishId 不能超过 200 字符');
  if (publicText.length > 1000) throw validationError('评价文字不能超过 1000 字符');
  if (!publicText && rating === null) throw validationError('评价文字和评分至少填写一项');
  return { branchId, dishId, publicText, rating, media: normalizeMedia(body.media) };
}

module.exports = { validateReviewSubmission, MAX_MEDIA_ITEMS, MAX_MEDIA_BYTES };
