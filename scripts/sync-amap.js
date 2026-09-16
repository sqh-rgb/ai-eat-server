const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getPool, withTransaction, closePool } = require('../src/db/pool');
const { collectPois } = require('../src/providers/amapProvider');
const { protectApprovedUpdates } = require('../src/import/approvedCandidateGuard');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function upsertPois(client, collection) {
  let inserted = 0;
  let updated = 0;
  for (const poi of collection.pois) {
    const evidence = collection.evidence.get(poi.externalId) || {};
    const sourceRecordId = `amap:branch:${poi.externalId}`;
    const hash = digest(poi.raw);
    const existing = await client.query('SELECT normalized_hash FROM source_records WHERE id=$1', [sourceRecordId]);
    await client.query(
      `
      INSERT INTO source_records(id,source_id,external_id,entity_type,evidence_url,normalized_hash,raw_payload,review_status,fetched_at)
      VALUES($1,'amap',$2,'branch',$3,$4,$5::jsonb,'candidate',NOW())
      ON CONFLICT(id) DO UPDATE SET evidence_url=EXCLUDED.evidence_url,normalized_hash=EXCLUDED.normalized_hash,
        raw_payload=EXCLUDED.raw_payload,fetched_at=NOW()
      `,
      [sourceRecordId, poi.externalId, evidence.requestUrl || '', hash, JSON.stringify(poi.raw)],
    );
    await client.query(
      `
      INSERT INTO merchants(id,canonical_name,aliases,review_status)
      VALUES($1,$2,$3::jsonb,'candidate')
      ON CONFLICT(id) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,aliases=EXCLUDED.aliases,updated_at=NOW()
      ${protectApprovedUpdates('merchants')}
      `,
      [`merchant:${poi.externalId}`, poi.name, JSON.stringify(poi.alias ? [poi.alias] : [])],
    );
    await client.query(
      `
      INSERT INTO branches(
        id,merchant_id,amap_poi,name,aliases,address,area,latitude,longitude,cuisine,phone,
        avg_cost,external_rating,review_status,primary_source_id,source_updated_at
      ) VALUES($1,$2,$1,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,'candidate','amap',NOW())
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,aliases=EXCLUDED.aliases,address=EXCLUDED.address,
        area=CASE WHEN branches.area='' THEN EXCLUDED.area ELSE branches.area END,
        latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,cuisine=EXCLUDED.cuisine,phone=EXCLUDED.phone,
        avg_cost=EXCLUDED.avg_cost,external_rating=EXCLUDED.external_rating,source_updated_at=NOW(),updated_at=NOW()
      ${protectApprovedUpdates('branches')}
      `,
      [
        poi.externalId, `merchant:${poi.externalId}`, poi.name, JSON.stringify(poi.alias ? [poi.alias] : []),
        poi.address, evidence.area || poi.businessArea, poi.lat, poi.lng, poi.type, poi.phone, poi.cost, poi.rating,
      ],
    );
    await client.query(
      `INSERT INTO branch_source_links(branch_id,source_record_id,match_method,match_confidence)
       VALUES($1,$2,'amap_poi',100) ON CONFLICT DO NOTHING`,
      [poi.externalId, sourceRecordId],
    );
    if (!existing.rows[0]) inserted += 1;
    else if (existing.rows[0].normalized_hash !== hash) updated += 1;
  }
  return { inserted, updated };
}

async function main() {
  getPool();
  const configFile = path.resolve(argument('--config', path.join(__dirname, '..', 'config', 'amap-swu.example.json')));
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const runId = crypto.randomUUID();
  const uniqueIds = new Set();
  let inserted = 0;
  let updated = 0;
  let requests = 0;
  await getPool().query("INSERT INTO ingestion_runs(id,source_id,status,note) VALUES($1,'amap','running',$2)", [runId, `配置：${path.basename(configFile)}`]);
  try {
    const collection = await collectPois(config, {
      onRetry({ attempt, waitMs, error }) {
        console.log(`高德限流/临时错误，${waitMs}ms 后进行第 ${attempt} 次重试：${error.code || error.message}`);
      },
      async onPage(pageResult) {
        for (const poi of pageResult.pois) uniqueIds.add(poi.externalId);
        const stats = await withTransaction(async client => {
          const pageStats = await upsertPois(client, pageResult);
          await client.query(
            `UPDATE ingestion_runs SET discovered_count=$2,inserted_count=inserted_count+$3,
             updated_count=updated_count+$4,note=$5 WHERE id=$1`,
            [runId, uniqueIds.size, pageStats.inserted, pageStats.updated, `已完成高德请求 ${pageResult.requests} 次；进度已分批保存`],
          );
          return pageStats;
        });
        inserted += stats.inserted;
        updated += stats.updated;
        requests = pageResult.requests;
        if (requests === 1 || requests % 10 === 0) {
          console.log(`高德进度：请求 ${requests} 次，去重候选 ${uniqueIds.size} 家，新增 ${inserted}`);
        }
      },
    });
    await getPool().query(
      `UPDATE ingestion_runs SET status='completed',ended_at=NOW(),discovered_count=$2,inserted_count=$3,updated_count=$4,
       note=$5 WHERE id=$1`,
      [runId, collection.pois.length, inserted, updated, `高德请求 ${collection.requests} 次；全部进入候选区`],
    );
    console.log(`高德同步完成：候选 ${collection.pois.length} 家，新增 ${inserted}，更新 ${updated}`);
  } catch (error) {
    const status = uniqueIds.size > 0 ? 'partial' : 'failed';
    await getPool().query(
      'UPDATE ingestion_runs SET status=$2,ended_at=NOW(),error_count=1,discovered_count=$3,note=$4 WHERE id=$1',
      [runId, status, uniqueIds.size, `${error.message}；已保存 ${uniqueIds.size} 家候选，可安全重跑去重补采`],
    );
    throw error;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(closePool);
