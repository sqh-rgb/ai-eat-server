const crypto = require('node:crypto');
const { periodFor, aggregateBranchRating } = require('../services/ratingAggregation');

async function insertSnapshots(client, snapshots, period, platformMean) {
  const chunkSize = 100;
  for (let start = 0; start < snapshots.length; start += chunkSize) {
    const chunk = snapshots.slice(start, start + chunkSize);
    const params = [];
    const values = chunk.map((snapshot, index) => {
      const offset = index * 11;
      const snapshotId = crypto.createHash('sha256')
        .update(`${snapshot.branchId}:${period.end}:${snapshot.formulaVersion}`).digest('hex');
      params.push(
        snapshotId, snapshot.branchId, period.start, period.end, snapshot.externalRating, platformMean,
        snapshot.userBayesianRating, snapshot.effectiveCount, snapshot.userWeight,
        snapshot.currentRating, snapshot.formulaVersion,
      );
      return `(${Array.from({ length: 11 }, (_, i) => `$${offset + i + 1}`).join(',')})`;
    });
    await client.query(
      `INSERT INTO branch_rating_snapshots(
        id,branch_id,period_start,period_end,external_rating,platform_mean,user_bayesian_rating,
        effective_rating_count,user_weight,current_rating,formula_version
      ) VALUES ${values.join(',')}
      ON CONFLICT(branch_id,period_end,formula_version) DO UPDATE SET
        external_rating=EXCLUDED.external_rating,platform_mean=EXCLUDED.platform_mean,
        user_bayesian_rating=EXCLUDED.user_bayesian_rating,effective_rating_count=EXCLUDED.effective_rating_count,
        user_weight=EXCLUDED.user_weight,current_rating=EXCLUDED.current_rating,created_at=NOW()`,
      params,
    );
  }
}

async function aggregateRatings({ pool, asOf = new Date() }) {
  const settlementTime = new Date(asOf);
  const period = periodFor(settlementTime);
  const [branchesResult, ratingsResult, meanResult] = await Promise.all([
    pool.query("SELECT id,external_rating FROM branches WHERE active=TRUE AND review_status='approved'"),
    pool.query(`SELECT rating_row.branch_id,rating_row.user_subject_hash,rating_row.rating,
                       rating_row.trust_weight,rating_row.submitted_at
                FROM user_ratings rating_row
                WHERE rating_row.status='approved' AND rating_row.risk_score < 30
                  AND rating_row.submitted_at <= $1
                  AND NOT EXISTS (
                    SELECT 1 FROM merchant_branch_memberships membership
                    WHERE membership.user_subject_hash=rating_row.user_subject_hash
                      AND membership.branch_id=rating_row.branch_id
                      AND membership.status='verified'
                  )`, [settlementTime]),
    pool.query("SELECT AVG(rating)::numeric(3,2) AS platform_mean FROM user_ratings WHERE status='approved'"),
  ]);
  const byBranch = new Map();
  for (const rating of ratingsResult.rows) {
    if (!byBranch.has(rating.branch_id)) byBranch.set(rating.branch_id, []);
    byBranch.get(rating.branch_id).push(rating);
  }
  const platformMean = Number(meanResult.rows[0]?.platform_mean || 4);
  const snapshots = branchesResult.rows.map(branch => ({
    branchId: branch.id,
    externalRating: branch.external_rating === null ? null : Number(branch.external_rating),
    ...aggregateBranchRating({
      externalRating: branch.external_rating,
      ratings: byBranch.get(branch.id) || [],
      platformMean,
      asOf: settlementTime,
    }),
  }));
  if (snapshots.length) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertSnapshots(client, snapshots, period, platformMean);
      await client.query(
        `UPDATE branches b SET
           user_rating=s.user_bayesian_rating,
           user_rating_effective_count=s.effective_rating_count,
           current_rating=s.current_rating,
           rating_updated_at=$3,
           updated_at=NOW()
         FROM branch_rating_snapshots s
         WHERE b.id=s.branch_id AND s.period_end=$1 AND s.formula_version=$2`,
        [period.end, 'half-month-v1', settlementTime],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    period, formulaVersion: 'half-month-v1', branchCount: snapshots.length,
    branchesWithUserRatings: snapshots.filter(item => item.effectiveCount > 0).length,
    platformMean,
  };
}

module.exports = { aggregateRatings };
