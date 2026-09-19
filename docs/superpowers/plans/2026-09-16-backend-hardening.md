# AI Eat Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复商家审核、候选重导入、迁移执行和私有图片上传的安全断点，使后端在不修改线上数据的前提下恢复全绿测试并具备可审查的上线条件。

**Architecture:** 把候选数据与已批准公开数据严格隔离；审核变更由事务化导入负责。迁移器以 `schema_migrations` 为唯一执行状态。用户图片通过上传意图绑定，客户端只能上传，附加与删除由后端状态机约束。

**Tech Stack:** Node.js 22、Express 4、PostgreSQL/Supabase、Supabase Storage、node:test、pg-mem。

**Spec:** `docs/PROJECT_STATUS.md`

## Global Constraints

- 不连接、迁移或写入线上数据库。
- 不上传数据或发布网站。
- 只有 `approved + confirmed + student_suitable` 商家可公开。
- 外部候选数据不得覆盖已经批准的公开字段。
- 图片必须属于当前用户的已确认上传意图，并在评价事务中原子附加。
- 每项生产代码修改前必须先运行能够复现问题的失败测试。

---

### Task 1: 恢复迁移测试并修复集中商家审核 SQL

**Files:**
- Modify: `db/migrations/012_upload_intents_and_admins.sql`
- Modify: `db/migrations/013_private_review_storage.postgres.sql`
- Modify: `src/import/branchAudit.js`
- Modify: `test/databaseIntegration.test.js`

**Interfaces:**
- Consumes: `prepareAuditPackage(text)` 与 PostgreSQL client。
- Produces: `importAudit(client, batch)` 能写入完整审核批次明细并更新分店。

- [ ] **Step 1: 写失败的集中审核集成测试**

在 `test/databaseIntegration.test.js` 中导入 `prepareAuditPackage`、`importAudit`，创建一条候选分店，执行包含完整核实字段的审核包，并断言分店变为 `approved/confirmed`、批次明细保存旧值。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/databaseIntegration.test.js`
Expected: FAIL，首先暴露 012 的 RLS 解析问题；拆分后应暴露审核明细 `UNNEST` 字段缺失。

- [ ] **Step 3: 拆分可移植表结构与 Supabase RLS**

从 012 移除：

```sql
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_upload_intents ENABLE ROW LEVEL SECURITY;
```

把这两句放入 013 的 Supabase 专属事务中，使 pg-mem 只执行可移植结构。

- [ ] **Step 4: 修复审核明细参数表**

让第一次 `UNNEST` 与更新语句使用相同的 15 个数组和列名，并传入 `entityKinds` 至 `verificationNotes`，确保 `i.entity_kind`、`i.existence_status` 等全部有来源。

- [ ] **Step 5: 运行集成测试和全套测试**

Run: `node --test test/databaseIntegration.test.js`
Expected: PASS。

Run: `npm test`
Expected: 58 项及新增测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add db/migrations/012_upload_intents_and_admins.sql db/migrations/013_private_review_storage.postgres.sql src/import/branchAudit.js test/databaseIntegration.test.js
git commit -m "fix: restore audited branch imports"
```

### Task 2: 禁止候选同步覆盖已批准实体

**Files:**
- Modify: `src/import/branchCandidates.js`
- Modify: `src/import/dishCandidates.js`
- Modify: `scripts/sync-amap.js`
- Modify: `test/databaseIntegration.test.js`

**Interfaces:**
- Consumes: 候选商家、菜品和高德 POI。
- Produces: 只有非 `approved` 实体会更新公开字段；原始来源仍更新 `source_records`。

- [ ] **Step 1: 扩展失败测试**

先批准已导入的分店和菜品，再以相同 ID 导入不同名称、地址、价格，断言批准实体的公开字段保持旧值，同时 `source_records.normalized_hash` 更新。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/databaseIntegration.test.js`
Expected: FAIL，名称、地址或价格被候选数据覆盖。

- [ ] **Step 3: 最小化保护 UPSERT**

在三个导入路径的公开实体 `ON CONFLICT ... DO UPDATE` 后加入审核状态条件：

```sql
WHERE branches.review_status <> 'approved'
```

菜品使用 `WHERE dishes.review_status <> 'approved'`；商家主表同样保护已批准名称。来源记录仍无条件更新，供后续重新审核使用。

- [ ] **Step 4: 运行目标测试和全套测试**

Run: `node --test test/databaseIntegration.test.js`
Expected: PASS。

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/import/branchCandidates.js src/import/dishCandidates.js scripts/sync-amap.js test/databaseIntegration.test.js
git commit -m "fix: protect approved catalog data from candidate sync"
```

### Task 3: 迁移器只执行未应用版本

**Files:**
- Create: `src/db/migrationRunner.js`
- Modify: `scripts/migrate.js`
- Create: `test/migrationRunner.test.js`

**Interfaces:**
- Produces: `migrationVersion(filename)`、`listPendingMigrations(client, files)`、`runMigrations(client, directory)`。
- Consumes: `schema_migrations.version`；首次数据库允许 001 创建该表。

- [ ] **Step 1: 写迁移版本与跳过行为测试**

覆盖 `008_name.postgres.sql -> 008_name`、001 首次执行、已记录版本跳过、后续版本按文件名顺序执行四种行为。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/migrationRunner.test.js`
Expected: FAIL with module not found。

- [ ] **Step 3: 实现迁移状态读取**

首次执行 001；之后查询：

```sql
SELECT version FROM schema_migrations
```

只执行集合中不存在的文件版本。脚本保留现有连接重试，但不再无条件重跑全部 SQL。

- [ ] **Step 4: 运行目标测试和全套测试**

Run: `node --test test/migrationRunner.test.js`
Expected: PASS。

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/db/migrationRunner.js scripts/migrate.js test/migrationRunner.test.js
git commit -m "fix: run only pending database migrations"
```

### Task 4: 收紧私有图片上传并绑定评价事务

**Files:**
- Modify: `db/migrations/012_upload_intents_and_admins.sql`
- Modify: `db/migrations/013_private_review_storage.postgres.sql`
- Modify: `src/services/storageUploads.js`
- Modify: `src/repositories/userRepository.js`
- Modify: `src/routes/user.js`
- Create: `test/storageUploads.test.js`
- Modify: `test/userFeatures.test.js`

**Interfaces:**
- Produces: `POST /api/v1/user/uploads`、`POST /api/v1/user/uploads/:id/confirm`、`GET /api/v1/user/uploads/:id/preview`、`DELETE /api/v1/user/uploads/:id`。
- Review input media uses `{ uploadIntentId, rightsConfirmed }`; server supplies storage key, MIME and byte size from the verified intent.

- [ ] **Step 1: 写上传验证与评价绑定失败测试**

覆盖非图片拒绝、跨用户 intent 拒绝、未确认 intent 拒绝、同一 intent 重复附加拒绝、合法 intent 在评价事务内变为 `attached`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/storageUploads.test.js test/userFeatures.test.js`
Expected: FAIL，路由缺失或旧 `storageKey` 协议不兼容。

- [ ] **Step 3: 改为 intent ID 协议并接入用户路由**

评价事务中执行：

```sql
SELECT * FROM user_upload_intents
WHERE id=$1 AND user_id=$2 AND status='uploaded'
FOR UPDATE
```

插入媒体后更新为 `attached` 并写入 `attached_submission_id`。客户端不再提交任意 `storageKey`、MIME 或字节数。

- [ ] **Step 4: 收紧 Storage 策略**

客户端只保留受路径约束的 INSERT/SELECT；撤销客户端 DELETE。删除操作由后端验证 `status <> 'attached'` 后通过受控凭证执行。上传意图增加用户并发/每日配额，过期任务不能确认。

- [ ] **Step 5: 运行目标测试和全套测试**

Run: `node --test test/storageUploads.test.js test/userFeatures.test.js`
Expected: PASS。

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 6: 更新项目状态并提交**

更新 `docs/PROJECT_STATUS.md`，明确 012/013 仍未上线且需要真实 Supabase 策略测试。

```bash
git add db/migrations/012_upload_intents_and_admins.sql db/migrations/013_private_review_storage.postgres.sql src/services/storageUploads.js src/repositories/userRepository.js src/routes/user.js test/storageUploads.test.js test/userFeatures.test.js docs/PROJECT_STATUS.md
git commit -m "feat: bind private uploads to review submissions"
```

### Final Verification

- [ ] Run: `npm test` — Expected: 0 failures。
- [ ] Run JavaScript syntax checks for `src`、`scripts`、`test` — Expected: 0 parse failures。
- [ ] Run: `npm audit --omit=dev` — Expected: 0 known vulnerabilities。
- [ ] Run: `git diff --check main...HEAD` — Expected: no whitespace errors。
- [ ] Verify `git status --short` is empty。
- [ ] Request independent code review before merging; do not merge, migrate, upload or deploy without the user's next confirmation。
