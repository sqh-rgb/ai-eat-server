BEGIN;

CREATE TABLE IF NOT EXISTS user_review_submissions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  user_subject_hash TEXT NOT NULL,
  public_text TEXT NOT NULL DEFAULT '' CHECK (char_length(public_text) <= 1000),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  moderation_reason TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(btrim(public_text)) > 0 OR rating IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS user_submission_media (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES user_review_submissions(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('sticker','review_photo')),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  width INTEGER CHECK (width IS NULL OR width BETWEEN 1 AND 12000),
  height INTEGER CHECK (height IS NULL OR height BETWEEN 1 AND 12000),
  rights_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(submission_id, storage_key)
);

CREATE INDEX IF NOT EXISTS idx_user_review_submissions_moderation
  ON user_review_submissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_user_review_submissions_branch
  ON user_review_submissions(branch_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_submission_media_review
  ON user_submission_media(submission_id, review_status);

INSERT INTO schema_migrations(version) VALUES ('005_review_submissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
