BEGIN;

DO $$ BEGIN
  ALTER TABLE review_risk_events ADD CONSTRAINT review_risk_events_rating_check
    CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO schema_migrations(version) VALUES ('010_review_risk_rating_constraint')
ON CONFLICT (version) DO NOTHING;

COMMIT;
