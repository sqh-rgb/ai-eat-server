const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const backendRoot = path.resolve(process.argv[2] || 'E:/AI work/ai-eat-server');
  const outputPath = path.resolve(process.argv[3] || 'approved-merchants-for-matching.json');
  const { getPool, closePool } = require(path.join(backendRoot, 'src', 'db', 'pool.js'));
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT b.id,b.amap_poi,b.name,b.aliases,b.address,b.area,b.cuisine,
             m.canonical_name AS merchant_name,m.aliases AS merchant_aliases
      FROM branches b
      LEFT JOIN merchants m ON m.id=b.merchant_id
      WHERE b.active=TRUE AND b.review_status='approved' AND b.student_suitable=TRUE
      ORDER BY b.name,b.id
    `);
    const records = result.rows.map(row => {
      const aliases = [...new Set([
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.merchant_aliases) ? row.merchant_aliases : []),
        row.merchant_name,
      ].map(value => String(value || '').trim()).filter(value => value && value !== row.name))];
      return {
        merchantId: row.id,
        amapPoiId: row.amap_poi || '',
        canonicalName: row.name,
        aliases,
        address: row.address || '',
        area: row.area || '',
        cuisine: row.cuisine || '',
        addressHints: [...new Set([row.area, row.address].map(value => String(value || '').trim()).filter(Boolean))],
      };
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputPath, count: records.length }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
