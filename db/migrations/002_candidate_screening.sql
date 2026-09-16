BEGIN;

CREATE TABLE IF NOT EXISTS candidate_screening_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  config JSONB NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  priority_count INTEGER NOT NULL DEFAULT 0,
  normal_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS branch_candidate_screenings (
  run_id TEXT NOT NULL REFERENCES candidate_screening_runs(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('priority','normal','low')),
  total_score NUMERIC(5,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  distance_meters INTEGER,
  distance_score NUMERIC(5,2) NOT NULL,
  price_score NUMERIC(5,2) NOT NULL,
  category_score NUMERIC(5,2) NOT NULL,
  rating_score NUMERIC(5,2) NOT NULL,
  completeness_score NUMERIC(5,2) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(run_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_screenings_rank
  ON branch_candidate_screenings(run_id, priority, rank);
CREATE INDEX IF NOT EXISTS idx_branch_screenings_branch
  ON branch_candidate_screenings(branch_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('002_candidate_screening')
ON CONFLICT (version) DO NOTHING;

COMMIT;
