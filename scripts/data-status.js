const { getPool, closePool } = require('../src/db/pool');

async function grouped(pool, table, column = 'review_status') {
  const result = await pool.query(`SELECT ${column} AS status,COUNT(*)::integer AS count FROM ${table} GROUP BY ${column} ORDER BY ${column}`);
  return Object.fromEntries(result.rows.map(row => [row.status, Number(row.count)]));
}

async function total(pool, table) {
  const result = await pool.query(`SELECT COUNT(*)::integer AS count FROM ${table}`);
  return Number(result.rows[0].count);
}

async function main() {
  const pool = getPool();
  const [branches, branchExistence, venues, dishes, reviews, media, licenses, leads, userRatings, reviewSubmissions, submissionMedia, reviewRisk, preferences, favorites, consumptionRecords, recommendationEvents, ratingSnapshots, batches, runs, screenings] = await Promise.all([
    grouped(pool, 'branches'),
    grouped(pool, 'branches', 'existence_status'),
    grouped(pool, 'venues'),
    grouped(pool, 'dishes'),
    grouped(pool, 'reviews', 'status'),
    grouped(pool, 'media_assets'),
    grouped(pool, 'food_licenses'),
    grouped(pool, 'discovery_leads'),
    grouped(pool, 'user_ratings', 'status'),
    grouped(pool, 'user_review_submissions', 'status'),
    grouped(pool, 'user_submission_media'),
    grouped(pool, 'review_risk_events', 'decision'),
    total(pool, 'user_preferences'),
    total(pool, 'user_favorites'),
    total(pool, 'consumption_records'),
    total(pool, 'recommendation_events'),
    pool.query('SELECT id,branch_id,period_start,period_end,effective_rating_count,user_weight,current_rating,formula_version,created_at FROM branch_rating_snapshots ORDER BY period_end DESC,created_at DESC LIMIT 5'),
    pool.query('SELECT id,status,imported_count,imported_at,rolled_back_at FROM review_import_batches ORDER BY imported_at DESC LIMIT 5'),
    pool.query('SELECT id,source_id,status,discovered_count,inserted_count,updated_count,error_count,started_at,ended_at,note FROM ingestion_runs ORDER BY started_at DESC LIMIT 10'),
    pool.query('SELECT id,status,candidate_count,priority_count,normal_count,low_count,created_at,completed_at,note FROM candidate_screening_runs ORDER BY created_at DESC LIMIT 5'),
  ]);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    counts: {
      branches, branchExistence, venues, dishes, reviews, media, foodLicenses: licenses, discoveryLeads: leads,
      userRatings, reviewSubmissions, submissionMedia, reviewRisk,
      userPreferences: preferences, userFavorites: favorites, consumptionRecords, recommendationEvents,
    },
    latestRatingSnapshots: ratingSnapshots.rows,
    latestReviewBatches: batches.rows,
    latestIngestionRuns: runs.rows,
    latestCandidateScreenings: screenings.rows,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
