BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS user_rating NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS user_rating_effective_count NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_rating NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS rating_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_ratings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_subject_hash TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  trust_weight NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (trust_weight BETWEEN 0 AND 1.2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branch_rating_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  external_rating NUMERIC(3,2),
  platform_mean NUMERIC(3,2) NOT NULL,
  user_bayesian_rating NUMERIC(3,2),
  effective_rating_count NUMERIC(10,2) NOT NULL DEFAULT 0,
  user_weight NUMERIC(5,4) NOT NULL DEFAULT 0,
  current_rating NUMERIC(3,2),
  formula_version TEXT NOT NULL DEFAULT 'half-month-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, period_end, formula_version)
);

CREATE INDEX IF NOT EXISTS idx_user_ratings_aggregate
  ON user_ratings(branch_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_ratings_subject
  ON user_ratings(user_subject_hash, branch_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_rating_snapshots_branch
  ON branch_rating_snapshots(branch_id, period_end DESC);

INSERT INTO data_sources(id,source_type,display_name,base_url)
VALUES ('user-submission','user_submission','AI Eat 用户投稿','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('004_user_rating_snapshots')
ON CONFLICT (version) DO NOTHING;

COMMIT;
