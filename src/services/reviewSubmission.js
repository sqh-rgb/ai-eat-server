const MAX_MEDIA_ITEMS = 9;

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
  const normalized = media.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw validationError(`第 ${index + 1} 个媒体项格式错误`);
    const uploadIntentId = String(item.uploadIntentId || '').trim();
    if (!uploadIntentId || uploadIntentId.length > 200) throw validationError(`第 ${index + 1} 个上传意图无效`);
    if (item.rightsConfirmed !== true) throw validationError(`第 ${index + 1} 个媒体必须确认拥有图片权利`);
    return {
      uploadIntentId,
      rightsConfirmed: true,
    };
  });
  if (new Set(normalized.map(item => item.uploadIntentId)).size !== normalized.length) {
    throw validationError('同一上传意图不能在一条评价中重复使用');
  }
  return normalized;
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

module.exports = { validateReviewSubmission, MAX_MEDIA_ITEMS };
