BEGIN;

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venue_kind TEXT NOT NULL DEFAULT 'other'
    CHECK (venue_kind IN ('food_street','canteen','mall','campus_building','market','other')),
  address TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  review_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','approved','rejected')),
  existence_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (existence_status IN ('unverified','confirmed','uncertain','suspected_closed','temporarily_closed','permanently_closed')),
  verification_method TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_method IN ('none','map','official','merchant','onsite','multi_source')),
  verification_confidence SMALLINT NOT NULL DEFAULT 0 CHECK (verification_confidence BETWEEN 0 AND 100),
  verified_at TIMESTAMPTZ,
  reverify_after TIMESTAMPTZ,
  evidence_url TEXT NOT NULL DEFAULT '',
  verification_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS entity_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK (entity_kind IN ('standalone_store','stall','canteen_counter','mobile_vendor','unknown')),
  ADD COLUMN IF NOT EXISTS venue_id TEXT REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS location_detail TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS existence_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (existence_status IN ('unverified','confirmed','uncertain','suspected_closed','temporarily_closed','permanently_closed')),
  ADD COLUMN IF NOT EXISTS verification_method TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_method IN ('none','map','official','merchant','onsite','multi_source')),
  ADD COLUMN IF NOT EXISTS verification_confidence SMALLINT NOT NULL DEFAULT 0
    CHECK (verification_confidence BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverify_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_evidence_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verification_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS merchant_branch_memberships (
  id TEXT PRIMARY KEY,
  user_subject_hash TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff','agency')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','revoked')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_subject_hash, branch_id)
);

ALTER TABLE user_review_submissions
  ADD COLUMN IF NOT EXISTS device_subject_hash TEXT,
  ADD COLUMN IF NOT EXISTS network_subject_hash TEXT,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS risk_score SMALLINT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS risk_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (risk_status IN ('pending','allow','manual_review','blocked')),
  ADD COLUMN IF NOT EXISTS risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE user_ratings
  ADD COLUMN IF NOT EXISTS origin_submission_id TEXT REFERENCES user_review_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risk_score SMALLINT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100);

ALTER TABLE branch_audit_batch_items
  ADD COLUMN IF NOT EXISTS previous_entity_kind TEXT,
  ADD COLUMN IF NOT EXISTS previous_venue_id TEXT,
  ADD COLUMN IF NOT EXISTS previous_location_detail TEXT,
  ADD COLUMN IF NOT EXISTS previous_existence_status TEXT,
  ADD COLUMN IF NOT EXISTS previous_verification_method TEXT,
  ADD COLUMN IF NOT EXISTS previous_verification_confidence SMALLINT,
  ADD COLUMN IF NOT EXISTS previous_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_reverify_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_verification_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS previous_verification_note TEXT,
  ADD COLUMN IF NOT EXISTS applied_existence_status TEXT;

CREATE TABLE IF NOT EXISTS review_risk_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT REFERENCES user_review_submissions(id) ON DELETE SET NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_subject_hash TEXT NOT NULL,
  device_subject_hash TEXT,
  network_subject_hash TEXT,
  content_fingerprint TEXT,
  risk_score SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  decision TEXT NOT NULL CHECK (decision IN ('allow','manual_review','blocked')),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluator_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venues_public
  ON venues(active, review_status, existence_status);
CREATE INDEX IF NOT EXISTS idx_branches_verified_public
  ON branches(active, review_status, student_suitable, existence_status);
CREATE INDEX IF NOT EXISTS idx_branches_venue ON branches(venue_id);
CREATE INDEX IF NOT EXISTS idx_memberships_subject_branch
  ON merchant_branch_memberships(user_subject_hash, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_review_risk_subject_time
  ON review_risk_events(user_subject_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_risk_device_branch_time
  ON review_risk_events(device_subject_hash, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_risk_network_branch_time
  ON review_risk_events(network_subject_hash, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_risk_content
  ON review_risk_events(content_fingerprint, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ratings_origin_submission
  ON user_ratings(origin_submission_id) WHERE origin_submission_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('007_branch_verification_and_review_fraud')
ON CONFLICT (version) DO NOTHING;

COMMIT;
