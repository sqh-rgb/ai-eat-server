const crypto = require('node:crypto');
const db = require('../db/pool');
const { validateReviewSubmission } = require('../services/reviewSubmission');
const { assessReviewRisk } = require('../services/reviewFraudGuard');
const { hashIdentity } = require('../services/identityHash');

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

async function requirePublicBranch(client, branchId, dishId = null) {
  const result = await client.query(
    `SELECT b.id,b.name,d.id AS dish_id
     FROM branches b
     LEFT JOIN dishes d ON d.id=$2 AND d.branch_id=b.id AND d.available=TRUE AND d.review_status='approved'
     WHERE b.id=$1 AND b.active=TRUE AND b.review_status='approved'
       AND b.student_suitable=TRUE AND b.existence_status='confirmed'`,
    [branchId, dishId],
  );
  const row = result.rows[0];
  if (!row || (dishId && !row.dish_id)) {
    const error = new Error(dishId ? '菜品不存在或不属于该商家' : '商家尚未确认营业或不可用');
    error.code = 'TARGET_NOT_AVAILABLE';
    error.status = 409;
    throw error;
  }
  return row;
}

async function getPreferences(userId) {
  const result = await db.query('SELECT * FROM user_preferences WHERE user_id=$1', [userId]);
  const row = result.rows[0];
  return row ? {
    tastes: row.tastes,
    spiceLevels: row.spice_levels,
    defaultBudget: numberOrNull(row.default_budget),
    defaultRadius: Number(row.default_radius),
    defaultFulfillment: row.default_fulfillment,
  } : { tastes: [], spiceLevels: [], defaultBudget: 30, defaultRadius: 2000, defaultFulfillment: 'dine_in' };
}

async function savePreferences(userId, preferences) {
  await db.query(
    `INSERT INTO user_preferences(user_id,tastes,spice_levels,default_budget,default_radius,default_fulfillment)
     VALUES($1,$2::jsonb,$3::jsonb,$4,$5,$6)
     ON CONFLICT(user_id) DO UPDATE SET tastes=EXCLUDED.tastes,spice_levels=EXCLUDED.spice_levels,
       default_budget=EXCLUDED.default_budget,default_radius=EXCLUDED.default_radius,
       default_fulfillment=EXCLUDED.default_fulfillment,updated_at=NOW()`,
    [userId, JSON.stringify(preferences.tastes), JSON.stringify(preferences.spiceLevels),
      preferences.defaultBudget, preferences.defaultRadius, preferences.defaultFulfillment],
  );
  return getPreferences(userId);
}

async function listFavorites(userId) {
  const result = await db.query(
    `SELECT f.id,f.created_at,b.id AS branch_id,b.name,b.address,b.area,b.cuisine,b.avg_cost,
            b.current_rating,v.name AS venue_name
     FROM user_favorites f JOIN branches b ON b.id=f.branch_id
     LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE AND v.review_status='approved'
       AND v.existence_status='confirmed'
     WHERE f.user_id=$1 AND b.active=TRUE AND b.review_status='approved'
       AND b.student_suitable=TRUE AND b.existence_status='confirmed'
     ORDER BY f.created_at DESC`,
    [userId],
  );
  return result.rows.map(row => ({
    id: row.id, branchId: row.branch_id,
    branchName: row.venue_name ? `${row.venue_name} · ${row.name}` : row.name,
    address: row.address, area: row.area, cuisine: row.cuisine,
    avgCost: numberOrNull(row.avg_cost), currentRating: numberOrNull(row.current_rating),
    createdAt: row.created_at,
  }));
}

async function addFavorite(userId, branchId) {
  return db.withTransaction(async client => {
    await requirePublicBranch(client, branchId);
    const id = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO user_favorites(id,user_id,branch_id) VALUES($1,$2,$3)
       ON CONFLICT(user_id,branch_id) DO UPDATE SET user_id=EXCLUDED.user_id
       RETURNING id,branch_id,created_at`,
      [id, userId, branchId],
    );
    return result.rows[0];
  });
}

async function removeFavorite(userId, favoriteId) {
  const result = await db.query('DELETE FROM user_favorites WHERE id=$1 AND user_id=$2', [favoriteId, userId]);
  return result.rowCount > 0;
}

async function addConsumptionRecord(userId, record) {
  return db.withTransaction(async client => {
    await requirePublicBranch(client, record.branchId, record.dishId);
    const id = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO consumption_records(id,user_id,branch_id,dish_id,consumed_at,amount,note)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, userId, record.branchId, record.dishId, record.consumedAt, record.amount, record.note],
    );
    return result.rows[0];
  });
}

async function listConsumptionRecords(userId, { limit, offset }) {
  const result = await db.query(
    `SELECT r.id,r.branch_id,r.dish_id,r.consumed_at,r.amount,r.note,r.created_at,
            b.name AS branch_name,d.name AS dish_name
     FROM consumption_records r JOIN branches b ON b.id=r.branch_id
     LEFT JOIN dishes d ON d.id=r.dish_id
     WHERE r.user_id=$1 ORDER BY r.consumed_at DESC,r.id LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return result.rows.map(row => ({
    id: row.id, branchId: row.branch_id, branchName: row.branch_name,
    dishId: row.dish_id, dishName: row.dish_name, consumedAt: row.consumed_at,
    amount: numberOrNull(row.amount), note: row.note, createdAt: row.created_at,
  }));
}

async function recordRecommendationEvent(userId, event) {
  return db.withTransaction(async client => {
    if (event.branchId) await requirePublicBranch(client, event.branchId, event.dishId);
    else if (event.dishId) {
      const dish = await client.query('SELECT branch_id FROM dishes WHERE id=$1', [event.dishId]);
      if (!dish.rows[0]) await requirePublicBranch(client, '__missing__');
      await requirePublicBranch(client, dish.rows[0].branch_id, event.dishId);
      event.branchId = dish.rows[0].branch_id;
    }
    const id = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO recommendation_events(id,user_id,anonymous_session_id,dish_id,branch_id,event_type,client_event_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT(user_id,client_event_id) DO NOTHING RETURNING id,created_at`,
      [id, userId, event.sessionId, event.dishId, event.branchId, event.eventType,
        event.clientEventId, JSON.stringify(event.metadata)],
    );
    return result.rows[0] || { duplicate: true };
  });
}

async function createReviewSubmission({ userId, userSubjectHash, networkValue, deviceValue, input }) {
  const review = validateReviewSubmission(input);
  const clientRequestId = String(input.clientRequestId || '').trim() || null;
  if (clientRequestId && clientRequestId.length > 200) {
    const error = new Error('clientRequestId 过长');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }
  return db.withTransaction(async client => {
    await requirePublicBranch(client, review.branchId, review.dishId);
    if (clientRequestId) {
      const prior = await client.query(
        'SELECT id,status,risk_status,risk_score,submitted_at FROM user_review_submissions WHERE user_subject_hash=$1 AND client_request_id=$2',
        [userSubjectHash, clientRequestId],
      );
      if (prior.rows[0]) return { ...prior.rows[0], duplicate: true };
    }
    const contentFingerprint = hashIdentity(review.publicText.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase(), 'content');
    const deviceSubjectHash = hashIdentity(deviceValue, 'device');
    const networkSubjectHash = hashIdentity(networkValue, 'network');
    for (const item of review.media) {
      if (!item.storageKey.startsWith(`review-submissions/${userSubjectHash}/`)) {
        const error = new Error('图片 storageKey 不属于当前用户的待审目录');
        error.code = 'INVALID_MEDIA_OWNER';
        error.status = 400;
        throw error;
      }
    }
    const countResult = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE user_subject_hash=$1 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '30 days')::integer AS same_user_branch_30d,
        COUNT(*) FILTER (WHERE user_subject_hash=$1 AND created_at>=NOW()-INTERVAL '1 hour')::integer AS user_hour,
        COUNT(*) FILTER (WHERE user_subject_hash=$1 AND created_at>=NOW()-INTERVAL '1 day')::integer AS user_day,
        COUNT(*) FILTER (WHERE device_subject_hash=$3 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '1 day')::integer AS same_device_branch_24h,
        COUNT(*) FILTER (WHERE network_subject_hash=$4 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '1 hour')::integer AS same_network_branch_hour,
        COUNT(*) FILTER (WHERE content_fingerprint=$5 AND created_at>=NOW()-INTERVAL '90 days')::integer AS same_content_90d,
        COUNT(*) FILTER (WHERE branch_id=$2 AND rating=5 AND created_at>=NOW()-INTERVAL '1 hour')::integer AS branch_five_star_hour
       FROM review_risk_events`,
      [userSubjectHash, review.branchId, deviceSubjectHash, networkSubjectHash, contentFingerprint],
    );
    const membership = await client.query(
      `SELECT 1 FROM merchant_branch_memberships
       WHERE user_subject_hash=$1 AND branch_id=$2 AND status='verified' LIMIT 1`,
      [userSubjectHash, review.branchId],
    );
    const row = countResult.rows[0];
    const risk = assessReviewRisk({
      rating: review.rating, publicText: review.publicText,
      isVerifiedMerchantForBranch: Boolean(membership.rows[0]),
      counts: {
        sameUserBranch30d: Number(row.same_user_branch_30d), userHour: Number(row.user_hour),
        userDay: Number(row.user_day), sameDeviceBranch24h: Number(row.same_device_branch_24h),
        sameNetworkBranchHour: Number(row.same_network_branch_hour), sameContent90d: Number(row.same_content_90d),
        branchFiveStarHour: Number(row.branch_five_star_hour),
      },
    });
    const id = crypto.randomUUID();
    const status = risk.decision === 'blocked' ? 'rejected' : 'pending';
    await client.query(
      `INSERT INTO user_review_submissions(
        id,branch_id,dish_id,user_subject_hash,public_text,rating,status,moderation_reason,
        device_subject_hash,network_subject_hash,content_fingerprint,risk_score,risk_status,risk_reasons,client_request_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
      [id, review.branchId, review.dishId, userSubjectHash, review.publicText, review.rating, status,
        risk.decision === 'blocked' ? '自动风控拦截' : '', deviceSubjectHash, networkSubjectHash,
        contentFingerprint, risk.riskScore, risk.decision, JSON.stringify(risk.signals), clientRequestId],
    );
    for (const media of review.media) {
      await client.query(
        `INSERT INTO user_submission_media(id,submission_id,media_kind,storage_key,mime_type,byte_size,width,height,rights_confirmed)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(), id, media.mediaKind, media.storageKey, media.mimeType,
          media.byteSize, media.width, media.height, media.rightsConfirmed],
      );
    }
    await client.query(
      `INSERT INTO review_risk_events(
        id,submission_id,branch_id,user_subject_hash,device_subject_hash,network_subject_hash,
        content_fingerprint,risk_score,decision,signals,evaluator_version,rating
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
      [crypto.randomUUID(), id, review.branchId, userSubjectHash, deviceSubjectHash, networkSubjectHash,
        contentFingerprint, risk.riskScore, risk.decision, JSON.stringify(risk.signals), risk.evaluatorVersion, review.rating],
    );
    return { id, status, riskStatus: risk.decision, submittedAt: new Date().toISOString(), duplicate: false };
  });
}

async function listOwnReviewSubmissions(userSubjectHash, { limit, offset }) {
  const result = await db.query(
    `SELECT id,branch_id,dish_id,public_text,rating,status,risk_status,moderation_reason,submitted_at
     FROM user_review_submissions WHERE user_subject_hash=$1
     ORDER BY submitted_at DESC,id LIMIT $2 OFFSET $3`,
    [userSubjectHash, limit, offset],
  );
  return result.rows;
}

module.exports = {
  getPreferences, savePreferences, listFavorites, addFavorite, removeFavorite,
  addConsumptionRecord, listConsumptionRecords, recordRecommendationEvent,
  createReviewSubmission, listOwnReviewSubmissions, requirePublicBranch,
};
