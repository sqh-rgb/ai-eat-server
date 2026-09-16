BEGIN;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'ai-eat-review-submissions','ai-eat-review-submissions',FALSE,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT(id) DO UPDATE SET
  public=FALSE,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.is_ai_eat_admin(subject TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS(SELECT 1 FROM public.app_admins WHERE user_id=subject AND active=TRUE)
$$;

REVOKE ALL ON FUNCTION public.is_ai_eat_admin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ai_eat_admin(TEXT) TO authenticated;

DROP POLICY IF EXISTS ai_eat_review_upload_insert ON storage.objects;
CREATE POLICY ai_eat_review_upload_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='ai-eat-review-submissions'
  AND (storage.foldername(name))[1]=(SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS ai_eat_review_upload_read ON storage.objects;
CREATE POLICY ai_eat_review_upload_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='ai-eat-review-submissions'
  AND (
    owner_id=(SELECT auth.uid()::text)
    OR public.is_ai_eat_admin((SELECT auth.uid()::text))
  )
);

DROP POLICY IF EXISTS ai_eat_review_upload_delete ON storage.objects;
CREATE POLICY ai_eat_review_upload_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id='ai-eat-review-submissions'
  AND owner_id=(SELECT auth.uid()::text)
);

INSERT INTO schema_migrations(version) VALUES ('013_private_review_storage')
ON CONFLICT (version) DO NOTHING;

COMMIT;
