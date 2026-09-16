BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'amap','baidu_map','tencent_map','swu_official','government_registry',
    'qq_channel','social_discovery','merchant_authorized','user_submission','manual'
  )),
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  terms_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES data_sources(id),
  status TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed','rolled_back')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS source_records (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  external_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('merchant','branch','dish','license','review','discovery')),
  evidence_url TEXT NOT NULL DEFAULT '',
  normalized_hash TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, external_id, entity_type)
);

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchants(id),
  amap_poi TEXT UNIQUE,
  name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  address TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  cuisine TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',
  avg_cost NUMERIC(10,2),
  external_rating NUMERIC(3,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  primary_source_id TEXT REFERENCES data_sources(id),
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branch_source_links (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  source_record_id TEXT NOT NULL REFERENCES source_records(id),
  match_method TEXT NOT NULL DEFAULT 'external_id',
  match_confidence SMALLINT NOT NULL DEFAULT 100 CHECK (match_confidence BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(branch_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS food_licenses (
  id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE REFERENCES source_records(id),
  branch_id TEXT REFERENCES branches(id),
  legal_name TEXT NOT NULL,
  business_address TEXT NOT NULL DEFAULT '',
  business_scope TEXT NOT NULL DEFAULT '',
  issued_on DATE,
  valid_until DATE,
  license_status TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovery_leads (
  id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL UNIQUE REFERENCES source_records(id),
  platform TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_dishes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_url TEXT NOT NULL,
  observed_at DATE,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT NOT NULL DEFAULT '',
  price NUMERIC(10,2),
  spice_level SMALLINT CHECK (spice_level BETWEEN 0 AND 4),
  suitable_solo BOOLEAN,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  review_status TEXT NOT NULL DEFAULT 'candidate' CHECK (review_status IN ('candidate','approved','rejected')),
  primary_source_id TEXT REFERENCES data_sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, name)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('branch','dish','review')),
  entity_id TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('store_photo','dish_photo','sticker','review_photo','illustration')),
  source_id TEXT REFERENCES data_sources(id),
  source_url TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  alt_text TEXT NOT NULL DEFAULT '',
  rights_status TEXT NOT NULL DEFAULT 'pending' CHECK (rights_status IN ('pending','approved','rejected')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_import_batches (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  content_sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','rolled_back')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  source_review_id TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  dish_id TEXT REFERENCES dishes(id),
  parent_review_id TEXT REFERENCES reviews(id),
  public_text TEXT NOT NULL,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  display_date TEXT NOT NULL DEFAULT '',
  source_published_at TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected','removed')),
  import_batch_id TEXT REFERENCES review_import_batches(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, source_review_id)
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT 'local-reviewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id TEXT PRIMARY KEY,
  anonymous_session_id TEXT,
  dish_id TEXT REFERENCES dishes(id),
  branch_id TEXT REFERENCES branches(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('shown','opened','accepted','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_public ON branches(active, review_status);
CREATE INDEX IF NOT EXISTS idx_branches_location ON branches(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_dishes_public ON dishes(available, review_status, category, price);
CREATE INDEX IF NOT EXISTS idx_reviews_branch_public ON reviews(branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_dish_public ON reviews(dish_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_entity_public ON media_assets(entity_type, entity_id, review_status, rights_status);
CREATE INDEX IF NOT EXISTS idx_recommendation_session ON recommendation_events(anonymous_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_records_review ON source_records(source_id, entity_type, review_status);
CREATE INDEX IF NOT EXISTS idx_food_licenses_branch ON food_licenses(branch_id, license_status);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_review ON discovery_leads(platform, review_status);

INSERT INTO data_sources(id,source_type,display_name,base_url)
VALUES
  ('amap','amap','高德地图','https://lbs.amap.com/'),
  ('swu-official','swu_official','西南大学官方公开信息','https://www.swu.edu.cn/'),
  ('cq-beibei-food-license','government_registry','北碚区食品经营许可公示','https://scjgj.cq.gov.cn/'),
  ('qq-channel','qq_channel','西南大学相关公开社区讨论','https://pd.qq.com/'),
  ('social-discovery','social_discovery','公开社交平台线索（仅发现与核验）',''),
  ('merchant-authorized','merchant_authorized','商家授权资料',''),
  ('manual','manual','人工核验','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('001_core') ON CONFLICT (version) DO NOTHING;

COMMIT;
