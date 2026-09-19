BEGIN;

CREATE TABLE IF NOT EXISTS app_admins (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer','admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by TEXT NOT NULL DEFAULT 'local-owner',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_upload_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_subject_hash TEXT NOT NULL,
  bucket_id TEXT NOT NULL DEFAULT 'ai-eat-review-submissions',
  storage_key TEXT NOT NULL UNIQUE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('sticker','review_photo')),
  expected_mime_type TEXT NOT NULL CHECK (expected_mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  expected_byte_size INTEGER NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 10485760),
  actual_mime_type TEXT,
  actual_byte_size INTEGER,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','uploaded','attached','rejected','deleted','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  attached_submission_id TEXT REFERENCES user_review_submissions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_upload_intents ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_submission_media
  ADD COLUMN IF NOT EXISTS upload_intent_id TEXT REFERENCES user_upload_intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_upload_intents_user_status
  ON user_upload_intents(user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_intents_user_created
  ON user_upload_intents(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_intents_expiry
  ON user_upload_intents(status,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_media_upload_intent
  ON user_submission_media(upload_intent_id) WHERE upload_intent_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('012_upload_intents_and_admins')
ON CONFLICT (version) DO NOTHING;

COMMIT;
