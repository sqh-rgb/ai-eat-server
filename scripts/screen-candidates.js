const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { screenCandidates } = require('../src/services/candidateScreening');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function insertRows(client, runId, rows) {
  const size = 100;
  for (let start = 0; start < rows.length; start += size) {
    const chunk = rows.slice(start, start + size);
    const params = [];
    const values = chunk.map((row, index) => {
      const offset = index * 17;
      params.push(
        runId, row.id, row.rank, row.priority, row.total_score, row.distance_meters,
        row.scores.distance, row.scores.price, row.scores.category, row.scores.rating,
        row.scores.completeness, row.taste_review_count, row.recommended_dish_count,
        row.scores.tasteReviews, row.scores.recommendedDishes,
        JSON.stringify(row.reasons), JSON.stringify(row.warnings),
      );
      return `(${Array.from({ length: 17 }, (_, i) => `$${offset + i + 1}`).join(',')})`;
    });
    await client.query(
      `INSERT INTO branch_candidate_screenings(
        run_id,branch_id,rank,priority,total_score,distance_meters,distance_score,price_score,
        category_score,rating_score,completeness_score,taste_review_count,recommended_dish_count,
        taste_review_score,recommended_dish_score,reasons,warnings
      ) VALUES ${values.join(',')}`,
      params,
    );
  }
}

async function main() {
  const configFile = path.resolve(argument('--config', path.join(__dirname, '..', 'config', 'student-screening.json')));
  const outFile = argument('--out');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const result = await getPool().query(
    `SELECT b.id,b.name,b.address,b.area,b.latitude,b.longitude,b.cuisine,b.phone,b.avg_cost,
            b.external_rating,b.primary_source_id,
            COUNT(DISTINCT r.id) FILTER (
              WHERE r.parent_review_id IS NULL
                AND r.status IN ('pending','published')
                AND r.public_text ~ '(好吃|味道|口味|香|辣|甜|咸|鲜|酥|嫩|推荐|踩雷|难吃)'
            )::integer AS taste_review_count,
            COUNT(DISTINCT d.id) FILTER (
              WHERE d.available=TRUE AND d.review_status IN ('candidate','approved')
            )::integer AS recommended_dish_count
     FROM branches b
     LEFT JOIN reviews r ON r.branch_id=b.id
     LEFT JOIN dishes d ON d.branch_id=b.id
     WHERE b.active=TRUE AND b.review_status='candidate'
     GROUP BY b.id`,
  );
  const rows = screenCandidates(result.rows, config);
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.priority]: (acc[row.priority] || 0) + 1 }), {});
  const runId = crypto.randomUUID();
  await withTransaction(async client => {
    await client.query(
      `INSERT INTO candidate_screening_runs(id,status,config,candidate_count,priority_count,normal_count,low_count,note)
       VALUES($1,'running',$2::jsonb,$3,$4,$5,$6,$7)`,
      [runId, JSON.stringify(config), rows.length, counts.priority || 0, counts.normal || 0, counts.low || 0,
        '自动评分只决定人工审核顺序，不代表批准或拒绝'],
    );
    await insertRows(client, runId, rows);
    await client.query("UPDATE candidate_screening_runs SET status='completed',completed_at=NOW() WHERE id=$1", [runId]);
  });
  const snapshot = {
    generatedAt: new Date().toISOString(), runId, configFile: path.basename(configFile),
    counts: { total: rows.length, priority: counts.priority || 0, normal: counts.normal || 0, low: counts.low || 0 },
    rows,
  };
  if (outFile) {
    const resolved = path.resolve(outFile);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({ runId, ...snapshot.counts, outFile: outFile ? path.resolve(outFile) : null }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
