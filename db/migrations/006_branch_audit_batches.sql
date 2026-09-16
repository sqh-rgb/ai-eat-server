BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS student_suitable BOOLEAN,
  ADD COLUMN IF NOT EXISTS student_audit_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS student_audited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS branch_audit_batches (
  id TEXT PRIMARY KEY,
  content_sha256 TEXT NOT NULL UNIQUE,
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','rolled_back')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS branch_audit_batch_items (
  batch_id TEXT NOT NULL REFERENCES branch_audit_batches(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  poi_id TEXT NOT NULL,
  previous_review_status TEXT NOT NULL,
  previous_name TEXT NOT NULL,
  previous_student_suitable BOOLEAN,
  previous_student_audit_note TEXT NOT NULL DEFAULT '',
  applied_review_status TEXT NOT NULL,
  applied_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(batch_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_audit_items_branch
  ON branch_audit_batch_items(branch_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('006_branch_audit_batches')
ON CONFLICT (version) DO NOTHING;

COMMIT;
