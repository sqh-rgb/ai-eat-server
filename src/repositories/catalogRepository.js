const db = require('../db/pool');

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapRestaurant(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    amapPoi: row.amap_poi,
    name: row.name,
    displayName: row.venue_name ? `${row.venue_name} · ${row.name}` : row.name,
    entityKind: row.entity_kind,
    venueId: row.venue_id || null,
    venueName: row.venue_name || null,
    locationDetail: row.location_detail || '',
    existenceStatus: row.existence_status,
    verifiedAt: row.verified_at || null,
    address: row.address,
    area: row.area,
    lat: numberOrNull(row.latitude),
    lng: numberOrNull(row.longitude),
    cuisine: row.cuisine,
    phone: row.phone,
    businessHours: row.business_hours,
    avgCost: numberOrNull(row.avg_cost),
    externalRating: numberOrNull(row.external_rating),
    userRating: numberOrNull(row.user_rating),
    userRatingEffectiveCount: numberOrNull(row.user_rating_effective_count),
    currentRating: numberOrNull(row.current_rating),
    studentSuitable: row.student_suitable === true,
    ratingUpdatedAt: row.rating_updated_at || null,
    dishCount: Number(row.dish_count || 0),
    reviewCount: Number(row.review_count || 0),
    recommendationCount: Number(row.recommendation_count || 0),
    reviewRating: numberOrNull(row.review_rating),
    image: row.image_url || null,
    imageKind: row.media_kind || null,
  };
}

function mapDish(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    branchDisplayName: row.venue_name ? `${row.venue_name} · ${row.branch_name}` : row.branch_name,
    venueName: row.venue_name || null,
    locationDetail: row.location_detail || '',
    merchantId: row.merchant_id,
    name: row.name,
    category: row.category,
    price: numberOrNull(row.price),
    spiceLevel: numberOrNull(row.spice_level),
    suitableSolo: row.suitable_solo,
    cuisine: row.cuisine,
    address: row.address,
    area: row.area,
    lat: numberOrNull(row.latitude),
    lng: numberOrNull(row.longitude),
    distance: numberOrNull(row.distance_meters),
    externalRating: numberOrNull(row.external_rating),
    currentRating: numberOrNull(row.current_rating),
    reviewRating: numberOrNull(row.review_rating),
    reviewCount: Number(row.review_count || 0),
    recommendationCount: Number(row.recommendation_count || 0),
    sourceUpdatedAt: row.source_updated_at || null,
    image: row.image_url || null,
    imageKind: row.media_kind || null,
  };
}

async function listDishCandidates({ lat, lng, radius = 3000, limit = 200 }) {
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const result = await db.query(
    `
    WITH candidates AS (
      SELECT d.id,d.branch_id,d.name,d.category,d.price,d.spice_level,d.suitable_solo,
             b.merchant_id,b.name AS branch_name,b.address,b.area,b.latitude,b.longitude,
             b.location_detail,v.name AS venue_name,
             b.cuisine,b.external_rating,b.current_rating,b.source_updated_at,
             CASE WHEN $1::double precision IS NULL OR b.latitude IS NULL OR b.longitude IS NULL THEN NULL
                  ELSE 6371000 * ACOS(LEAST(1, GREATEST(-1,
                    COS(RADIANS($1)) * COS(RADIANS(b.latitude)) * COS(RADIANS(b.longitude) - RADIANS($2))
                    + SIN(RADIANS($1)) * SIN(RADIANS(b.latitude))
                  ))) END AS distance_meters
      FROM dishes d
      JOIN branches b ON b.id=d.branch_id
      LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
        AND v.review_status='approved' AND v.existence_status='confirmed'
      WHERE d.available=TRUE AND d.review_status='approved'
        AND b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
        AND b.existence_status='confirmed'
    )
    SELECT c.*,
           COALESCE(rv.review_count,0) AS review_count,
           rv.review_rating,
           COALESCE(rv.recommendation_count,0) AS recommendation_count,
           image.source_url AS image_url,
           image.media_kind
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS review_count,AVG(rating)::numeric(3,2) AS review_rating,
             COUNT(*) FILTER (WHERE public_text ~ '(推荐|必点|招牌|好吃)')::integer AS recommendation_count
      FROM reviews r WHERE r.dish_id=c.id AND r.status='published'
    ) rv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(storage_key,''),source_url) AS source_url,media_kind
      FROM media_assets
      WHERE entity_type='dish' AND entity_id=c.id
        AND review_status='approved' AND rights_status='approved'
      ORDER BY created_at DESC LIMIT 1
    ) image ON TRUE
    WHERE c.distance_meters IS NULL OR c.distance_meters <= $3
    ORDER BY c.distance_meters NULLS LAST,c.name
    LIMIT $4
    `,
    [hasLocation ? lat : null, hasLocation ? lng : null, radius, Math.min(Math.max(limit, 1), 500)],
  );
  return result.rows.map(mapDish);
}

async function listRestaurants({ limit = 50, offset = 0, area = '' }) {
  const result = await db.query(
    `
    SELECT b.id,b.merchant_id,b.amap_poi,b.name,b.address,b.area,b.latitude,b.longitude,
           b.entity_kind,b.venue_id,v.name AS venue_name,b.location_detail,b.existence_status,b.verified_at,
           b.cuisine,b.phone,b.business_hours,b.avg_cost,b.external_rating,b.user_rating,
           b.user_rating_effective_count,b.current_rating,b.rating_updated_at,b.student_suitable,
           COUNT(DISTINCT d.id)::integer AS dish_count,
           COUNT(DISTINCT r.id)::integer AS review_count,
           AVG(r.rating)::numeric(3,2) AS review_rating,
           image.source_url AS image_url,image.media_kind
    FROM branches b
    LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
      AND v.review_status='approved' AND v.existence_status='confirmed'
    LEFT JOIN dishes d ON d.branch_id=b.id AND d.available=TRUE AND d.review_status='approved'
    LEFT JOIN reviews r ON r.branch_id=b.id AND r.status='published'
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(storage_key,''),source_url) AS source_url,media_kind
      FROM media_assets
      WHERE entity_type='branch' AND entity_id=b.id
        AND review_status='approved' AND rights_status='approved'
      ORDER BY created_at DESC LIMIT 1
    ) image ON TRUE
    WHERE b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
      AND b.existence_status='confirmed' AND ($1='' OR b.area=$1)
    GROUP BY b.id,v.name,image.source_url,image.media_kind
    ORDER BY b.area,b.name
    LIMIT $2 OFFSET $3
    `,
    [area, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
  );
  return result.rows.map(mapRestaurant);
}

async function listRecommendationBranches({ lat, lng, radius = 3000, limit = 300 }) {
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const result = await db.query(
    `
    WITH candidates AS (
      SELECT b.id,b.merchant_id,b.name,b.address,b.area,b.latitude,b.longitude,b.cuisine,
             b.location_detail,v.name AS venue_name,
             b.avg_cost,b.external_rating,b.current_rating,b.source_updated_at,
             CASE WHEN $1::double precision IS NULL OR b.latitude IS NULL OR b.longitude IS NULL THEN NULL
                  ELSE 6371000 * ACOS(LEAST(1, GREATEST(-1,
                    COS(RADIANS($1)) * COS(RADIANS(b.latitude)) * COS(RADIANS(b.longitude) - RADIANS($2))
                    + SIN(RADIANS($1)) * SIN(RADIANS(b.latitude))
                  ))) END AS distance_meters
      FROM branches b
      LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
        AND v.review_status='approved' AND v.existence_status='confirmed'
      WHERE b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
        AND b.existence_status='confirmed'
    )
    SELECT c.*,
           COUNT(DISTINCT d.id)::integer AS dish_count,
           COUNT(DISTINCT r.id)::integer AS review_count,
           COUNT(DISTINCT r.id) FILTER (WHERE r.public_text ~ '(推荐|必点|招牌|好吃)')::integer AS recommendation_count,
           AVG(r.rating)::numeric(3,2) AS review_rating
    FROM candidates c
    LEFT JOIN dishes d ON d.branch_id=c.id AND d.available=TRUE AND d.review_status='approved'
    LEFT JOIN reviews r ON r.branch_id=c.id AND r.status='published'
    WHERE c.distance_meters IS NULL OR c.distance_meters <= $3
    GROUP BY c.id,c.merchant_id,c.name,c.address,c.area,c.latitude,c.longitude,c.cuisine,c.location_detail,c.venue_name,
             c.avg_cost,c.external_rating,c.current_rating,c.source_updated_at,c.distance_meters
    ORDER BY c.distance_meters NULLS LAST,c.name
    LIMIT $4
    `,
    [hasLocation ? lat : null, hasLocation ? lng : null, radius, Math.min(Math.max(limit, 1), 500)],
  );
  return result.rows.map(row => ({
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    displayName: row.venue_name ? `${row.venue_name} · ${row.name}` : row.name,
    venueName: row.venue_name || null,
    locationDetail: row.location_detail || '',
    address: row.address,
    area: row.area,
    lat: numberOrNull(row.latitude),
    lng: numberOrNull(row.longitude),
    cuisine: row.cuisine,
    avgCost: numberOrNull(row.avg_cost),
    externalRating: numberOrNull(row.external_rating),
    currentRating: numberOrNull(row.current_rating),
    reviewRating: numberOrNull(row.review_rating),
    reviewCount: Number(row.review_count || 0),
    recommendationCount: Number(row.recommendation_count || 0),
    dishCount: Number(row.dish_count || 0),
    distance: numberOrNull(row.distance_meters),
    sourceUpdatedAt: row.source_updated_at || null,
  }));
}

async function getRestaurant(id) {
  const result = await db.query(
    `
    SELECT b.*,v.name AS venue_name,
           COUNT(DISTINCT d.id)::integer AS dish_count,
           COUNT(DISTINCT r.id)::integer AS review_count,
           AVG(r.rating)::numeric(3,2) AS review_rating,
           image.source_url AS image_url,image.media_kind
    FROM branches b
    LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
      AND v.review_status='approved' AND v.existence_status='confirmed'
    LEFT JOIN dishes d ON d.branch_id=b.id AND d.available=TRUE AND d.review_status='approved'
    LEFT JOIN reviews r ON r.branch_id=b.id AND r.status='published'
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(storage_key,''),source_url) AS source_url,media_kind
      FROM media_assets
      WHERE entity_type='branch' AND entity_id=b.id
        AND review_status='approved' AND rights_status='approved'
      ORDER BY created_at DESC LIMIT 1
    ) image ON TRUE
    WHERE (b.id=$1 OR b.amap_poi=$1) AND b.active=TRUE AND b.review_status='approved'
      AND b.student_suitable=TRUE AND b.existence_status='confirmed'
    GROUP BY b.id,v.name,image.source_url,image.media_kind
    `,
    [id],
  );
  return result.rows[0] ? mapRestaurant(result.rows[0]) : null;
}

async function listDishesByBranch({ branchId, limit = 50, offset = 0 }) {
  const result = await db.query(
    `
    SELECT d.id,d.branch_id,d.name,d.category,d.price,d.spice_level,d.suitable_solo,
           b.merchant_id,b.name AS branch_name,b.address,b.area,b.latitude,b.longitude,
           b.location_detail,v.name AS venue_name,
           b.cuisine,b.external_rating,b.current_rating,b.source_updated_at,
           NULL::double precision AS distance_meters,
           COALESCE(rv.review_count,0) AS review_count,rv.review_rating,
           COALESCE(rv.recommendation_count,0) AS recommendation_count,
           image.source_url AS image_url,image.media_kind
    FROM dishes d JOIN branches b ON b.id=d.branch_id
    LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
      AND v.review_status='approved' AND v.existence_status='confirmed'
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS review_count,AVG(rating)::numeric(3,2) AS review_rating,
             COUNT(*) FILTER (WHERE public_text ~ '(推荐|必点|招牌|好吃)')::integer AS recommendation_count
      FROM reviews r WHERE r.dish_id=d.id AND r.status='published'
    ) rv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(storage_key,''),source_url) AS source_url,media_kind
      FROM media_assets
      WHERE entity_type='dish' AND entity_id=d.id
        AND review_status='approved' AND rights_status='approved'
      ORDER BY created_at DESC LIMIT 1
    ) image ON TRUE
    WHERE d.branch_id=$1 AND d.available=TRUE AND d.review_status='approved'
      AND b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
      AND b.existence_status='confirmed'
    ORDER BY d.category,d.name LIMIT $2 OFFSET $3
    `,
    [branchId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
  );
  return result.rows.map(mapDish);
}

async function getDish(id) {
  const result = await db.query(
    `
    SELECT d.id,d.branch_id,d.name,d.category,d.price,d.spice_level,d.suitable_solo,
           b.merchant_id,b.name AS branch_name,b.address,b.area,b.latitude,b.longitude,
           b.location_detail,v.name AS venue_name,
           b.cuisine,b.external_rating,b.current_rating,b.source_updated_at,NULL::double precision AS distance_meters,
           COALESCE(rv.review_count,0) AS review_count,rv.review_rating,
           COALESCE(rv.recommendation_count,0) AS recommendation_count,
           image.source_url AS image_url,image.media_kind
    FROM dishes d JOIN branches b ON b.id=d.branch_id
    LEFT JOIN venues v ON v.id=b.venue_id AND v.active=TRUE
      AND v.review_status='approved' AND v.existence_status='confirmed'
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS review_count,AVG(rating)::numeric(3,2) AS review_rating,
             COUNT(*) FILTER (WHERE public_text ~ '(推荐|必点|招牌|好吃)')::integer AS recommendation_count
      FROM reviews r WHERE r.dish_id=d.id AND r.status='published'
    ) rv ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(storage_key,''),source_url) AS source_url,media_kind
      FROM media_assets
      WHERE entity_type='dish' AND entity_id=d.id
        AND review_status='approved' AND rights_status='approved'
      ORDER BY created_at DESC LIMIT 1
    ) image ON TRUE
    WHERE d.id=$1 AND d.available=TRUE AND d.review_status='approved'
      AND b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
      AND b.existence_status='confirmed'
    `,
    [id],
  );
  return result.rows[0] ? mapDish(result.rows[0]) : null;
}

async function listReviews({ branchId, dishId = '', limit = 20, offset = 0 }) {
  const result = await db.query(
    `
    SELECT r.id,r.parent_review_id,r.public_text,r.rating,r.display_date,r.source_label,
           r.branch_id,r.dish_id
    FROM reviews r
    JOIN branches b ON b.id=r.branch_id AND b.active=TRUE AND b.review_status='approved'
      AND b.student_suitable=TRUE AND b.existence_status='confirmed'
    WHERE r.branch_id=$1 AND r.status='published' AND ($2='' OR r.dish_id=$2)
    ORDER BY r.created_at DESC,r.id
    LIMIT $3 OFFSET $4
    `,
    [branchId, dishId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
  );
  return result.rows;
}

module.exports = { listDishCandidates, listRecommendationBranches, listRestaurants, getRestaurant, getDish, listDishesByBranch, listReviews };
