BEGIN;

CREATE OR REPLACE FUNCTION prevent_merchant_self_review()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND EXISTS (
    SELECT 1 FROM merchant_branch_memberships membership
    WHERE membership.user_subject_hash = NEW.user_subject_hash
      AND membership.branch_id = NEW.branch_id
      AND membership.status = 'verified'
  ) THEN
    RAISE EXCEPTION 'verified merchant accounts cannot approve reviews or ratings for their own branch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_merchant_self_submission ON user_review_submissions;
CREATE TRIGGER trg_prevent_merchant_self_submission
BEFORE INSERT OR UPDATE OF status,branch_id,user_subject_hash ON user_review_submissions
FOR EACH ROW EXECUTE FUNCTION prevent_merchant_self_review();

DROP TRIGGER IF EXISTS trg_prevent_merchant_self_rating ON user_ratings;
CREATE TRIGGER trg_prevent_merchant_self_rating
BEFORE INSERT OR UPDATE OF status,branch_id,user_subject_hash ON user_ratings
FOR EACH ROW EXECUTE FUNCTION prevent_merchant_self_review();

INSERT INTO schema_migrations(version) VALUES ('008_merchant_self_review_trigger')
ON CONFLICT (version) DO NOTHING;

COMMIT;
