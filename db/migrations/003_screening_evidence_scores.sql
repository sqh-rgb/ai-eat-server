BEGIN;

ALTER TABLE branch_candidate_screenings
  ADD COLUMN IF NOT EXISTS taste_review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_dish_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taste_review_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recommended_dish_score NUMERIC(5,2) NOT NULL DEFAULT 0;

INSERT INTO schema_migrations(version) VALUES ('003_screening_evidence_scores')
ON CONFLICT (version) DO NOTHING;

COMMIT;
