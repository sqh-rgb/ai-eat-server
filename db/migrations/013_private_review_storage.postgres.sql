BEGIN;

ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_upload_intents ENABLE ROW LEVEL SECURITY;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'ai-eat-review-submissions','ai-eat-review-submissions',FALSE,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT(id) DO UPDATE SET
  public=FALSE,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.is_ai_eat_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.app_admins
    WHERE user_id=(SELECT auth.uid()::text) AND active=TRUE
  )
$$;

REVOKE ALL ON FUNCTION public.is_ai_eat_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ai_eat_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_valid_ai_eat_upload_intent(
  object_key TEXT,
  object_bucket TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_upload_intents
    WHERE user_id=(SELECT auth.uid()::text)
      AND storage_key=object_key
      AND bucket_id=object_bucket
      AND status='issued'
      AND expires_at>pg_catalog.now()
  )
$$;

REVOKE ALL ON FUNCTION public.has_valid_ai_eat_upload_intent(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_valid_ai_eat_upload_intent(TEXT,TEXT) TO authenticated;

DROP POLICY IF EXISTS ai_eat_review_upload_insert ON storage.objects;
CREATE POLICY ai_eat_review_upload_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='ai-eat-review-submissions'
  AND public.has_valid_ai_eat_upload_intent(
    name,
    bucket_id
  )
);

DROP POLICY IF EXISTS ai_eat_review_upload_read ON storage.objects;
CREATE POLICY ai_eat_review_upload_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='ai-eat-review-submissions'
  AND (
    owner_id=(SELECT auth.uid()::text)
    OR public.is_ai_eat_admin()
  )
);

DROP POLICY IF EXISTS ai_eat_review_upload_delete ON storage.objects;

INSERT INTO schema_migrations(version) VALUES ('013_private_review_storage')
ON CONFLICT (version) DO NOTHING;

COMMIT;
