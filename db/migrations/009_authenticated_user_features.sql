BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  tastes JSONB NOT NULL DEFAULT '[]'::jsonb,
  spice_levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_budget NUMERIC(10,2) NOT NULL DEFAULT 30 CHECK (default_budget BETWEEN 0 AND 1000),
  default_radius INTEGER NOT NULL DEFAULT 2000 CHECK (default_radius BETWEEN 100 AND 10000),
  default_fulfillment TEXT NOT NULL DEFAULT 'dine_in' CHECK (default_fulfillment IN ('dine_in','delivery')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS consumption_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount NUMERIC(10,2) CHECK (amount IS NULL OR amount BETWEEN 0 AND 10000),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recommendation_events
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS client_event_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_review_submissions
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

ALTER TABLE review_risk_events
  ADD COLUMN IF NOT EXISTS rating SMALLINT;

CREATE INDEX IF NOT EXISTS idx_user_favorites_user
  ON user_favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumption_records_user
  ON consumption_records(user_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendation_user
  ON recommendation_events(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_user_client_event
  ON recommendation_events(user_id, client_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_submission_subject_client_request
  ON user_review_submissions(user_subject_hash, client_request_id);

DROP INDEX IF EXISTS idx_user_ratings_origin_submission;
CREATE UNIQUE INDEX idx_user_ratings_origin_submission ON user_ratings(origin_submission_id);

INSERT INTO schema_migrations(version) VALUES ('009_authenticated_user_features')
ON CONFLICT (version) DO NOTHING;

COMMIT;
