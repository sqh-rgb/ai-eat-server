const APPROVED_ENTITY_TABLES = new Set(['merchants', 'branches', 'dishes']);

function protectApprovedUpdates(table) {
  if (!APPROVED_ENTITY_TABLES.has(table)) throw new Error(`不支持的候选实体表：${table}`);
  return `WHERE ${table}.review_status <> 'approved'`;
}

module.exports = { protectApprovedUpdates };
