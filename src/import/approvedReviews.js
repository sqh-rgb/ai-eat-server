const crypto = require('node:crypto');

function parseJsonLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`第 ${index + 1} 行不是有效 JSON`);
      }
    });
}

function validateReview(record, index = 0) {
  const id = String(record._id || '').trim();
  const sourceReviewId = String(record.sourceCommentHash || '').trim();
  const branchId = String(record.amapPoiId || record.restaurantId || '').trim();
  const publicText = String(record.publicText || '').trim();
  if (!id || !sourceReviewId || !branchId) throw new Error(`第 ${index + 1} 条缺少评论ID、来源哈希或分店ID`);
  if (publicText.length < 2 || publicText.length > 500) throw new Error(`第 ${index + 1} 条公开文字长度必须为 2～500`);
  if (record.status && record.status !== 'published') throw new Error(`第 ${index + 1} 条不是已批准发布状态`);
  if (Array.isArray(record.publicMedia) && record.publicMedia.length) {
    throw new Error(`第 ${index + 1} 条包含媒体；第一版禁止从采集包导入图片`);
  }
  return {
    id,
    sourceReviewId,
    branchId,
    parentSourceReviewId: String(record.parentSourceCommentHash || '').trim() || null,
    dishId: String(record.dishId || '').trim() || null,
    publicText,
    rating: Number.isInteger(record.rating) && record.rating >= 1 && record.rating <= 5 ? record.rating : null,
    displayDate: String(record.displayDate || '').trim(),
    sourcePublishedAt: String(record.sourcePublishedAt || '').trim(),
    sourceLabel: String(record.sourceLabel || '西南大学相关社区讨论').trim(),
    sentiment: ['positive', 'neutral', 'negative', 'unknown'].includes(record.sentiment) ? record.sentiment : 'unknown',
    reviewedAt: record.reviewedAt || null,
  };
}

function prepareBatch(text) {
  const records = parseJsonLines(text).map(validateReview);
  if (!records.length) throw new Error('导入文件没有已批准评论');
  const ids = new Set();
  const sourceIds = new Set();
  for (const record of records) {
    if (ids.has(record.id) || sourceIds.has(record.sourceReviewId)) throw new Error('导入文件包含重复评论ID');
    ids.add(record.id);
    sourceIds.add(record.sourceReviewId);
  }
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  return { records, sha256, batchId: `qq-${sha256.slice(0, 24)}` };
}

async function importBatch(client, batch) {
  const existing = await client.query('SELECT id,status,imported_count FROM review_import_batches WHERE content_sha256=$1', [batch.sha256]);
  if (existing.rows[0]) return { ...existing.rows[0], alreadyImported: true };

  const branchIds = [...new Set(batch.records.map(record => record.branchId))];
  const placeholders = branchIds.map((_, index) => `$${index + 1}`).join(',');
  const branches = await client.query(
    `SELECT id,amap_poi FROM branches WHERE review_status='approved' AND active=TRUE
     AND student_suitable=TRUE AND existence_status='confirmed'
     AND (id IN (${placeholders}) OR amap_poi IN (${placeholders}))`,
    branchIds,
  );
  const branchMap = new Map();
  for (const branch of branches.rows) {
    branchMap.set(branch.id, branch.id);
    if (branch.amap_poi) branchMap.set(branch.amap_poi, branch.id);
  }
  const missing = branchIds.filter(id => !branchMap.has(id));
  if (missing.length) throw new Error(`存在未审核、未确认营业或不存在的分店：${missing.slice(0, 10).join(', ')}`);

  const dishIds = [...new Set(batch.records.map(record => record.dishId).filter(Boolean))];
  const dishMap = new Map();
  if (dishIds.length) {
    const dishPlaceholders = dishIds.map((_, index) => `$${index + 1}`).join(',');
    const dishes = await client.query(
      `SELECT id,branch_id FROM dishes WHERE review_status='approved' AND available=TRUE
       AND id IN (${dishPlaceholders})`,
      dishIds,
    );
    for (const dish of dishes.rows) dishMap.set(dish.id, dish.branch_id);
    const invalid = batch.records
      .filter(record => record.dishId && dishMap.get(record.dishId) !== branchMap.get(record.branchId))
      .map(record => record.dishId);
    if (invalid.length) throw new Error(`存在未审核、不存在或不属于对应分店的菜品：${[...new Set(invalid)].slice(0, 10).join(', ')}`);
  }

  await client.query(
    `INSERT INTO review_import_batches(id,source_id,content_sha256,status,note)
     VALUES($1,'qq-channel',$2,'imported',$3)`,
    [batch.batchId, batch.sha256, 'approved-only 本地审核包'],
  );
  let imported = 0;
  const publicIdBySource = new Map(batch.records.map(record => [record.sourceReviewId, record.id]));
  for (const record of batch.records) {
    const result = await client.query(
      `
      INSERT INTO reviews(
        id,source_id,source_review_id,branch_id,dish_id,parent_review_id,public_text,rating,
        display_date,source_published_at,source_label,sentiment,status,import_batch_id,reviewed_at
      ) VALUES($1,'qq-channel',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',$12,COALESCE($13::timestamptz,NOW()))
      ON CONFLICT(source_id,source_review_id) DO NOTHING
      `,
      [
        record.id, record.sourceReviewId, branchMap.get(record.branchId), record.dishId, null,
        record.publicText, record.rating, record.displayDate, record.sourcePublishedAt,
        record.sourceLabel, record.sentiment, batch.batchId, record.reviewedAt,
      ],
    );
    imported += result.rowCount;
  }
  for (const record of batch.records) {
    const parentId = record.parentSourceReviewId ? publicIdBySource.get(record.parentSourceReviewId) : null;
    if (parentId) {
      await client.query(
        'UPDATE reviews SET parent_review_id=$2 WHERE source_id=\'qq-channel\' AND source_review_id=$1',
        [record.sourceReviewId, parentId],
      );
    }
  }
  await client.query('UPDATE review_import_batches SET imported_count=$2 WHERE id=$1', [batch.batchId, imported]);
  return { id: batch.batchId, status: 'imported', imported_count: imported, alreadyImported: false };
}

module.exports = { parseJsonLines, validateReview, prepareBatch, importBatch };
