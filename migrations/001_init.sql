-- =============================================================================
-- Askine — Initial schema for multi-tenant SaaS
-- =============================================================================
-- Run this in Supabase SQL Editor after creating a new project.
-- Idempotent — safe to re-run.

-- Extensions ------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector


-- Tenants (infoprodutores) ----------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug                          TEXT NOT NULL UNIQUE,             -- URL segment: /t/{slug}/mcp
  name                          TEXT NOT NULL,
  contact_email                 TEXT NOT NULL,
  plan_id                       TEXT NOT NULL DEFAULT 'starter',  -- 'starter' | 'pro' | 'scale' | 'enterprise'
  status                        TEXT NOT NULL DEFAULT 'trial',    -- 'trial' | 'active' | 'suspended' | 'canceled'
  trial_ends_at                 TIMESTAMPTZ,
  subscription_active_until     TIMESTAMPTZ,

  -- Integrations (encrypted at app layer before insert)
  panda_api_key_enc             TEXT,
  hotmart_app_token_enc         TEXT,
  hotmart_basic_token_enc       TEXT,
  validapay_customer_id         TEXT,

  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);


-- Courses ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS courses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,                                -- unique within tenant
  source_type         TEXT NOT NULL DEFAULT 'panda',                -- 'panda' | future adapters
  source_config       JSONB NOT NULL DEFAULT '{}'::jsonb,           -- e.g. { folder_id: '...' }
  hotmart_product_ids TEXT[] NOT NULL DEFAULT '{}',                 -- 1:N mapping
  ingest_status       TEXT NOT NULL DEFAULT 'pending',              -- 'pending' | 'ingesting' | 'ready' | 'error'
  ingest_error        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_courses_tenant      ON courses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_courses_status      ON courses(ingest_status);
CREATE INDEX IF NOT EXISTS idx_courses_hotmart_ids ON courses USING GIN(hotmart_product_ids);


-- Lessons (videos within a course) --------------------------------------------

CREATE TABLE IF NOT EXISTS lessons (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id             UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_video_id       TEXT NOT NULL,                              -- Panda video id
  lesson_number         INT,
  title                 TEXT NOT NULL,
  duration_sec          INT NOT NULL,
  hls_url               TEXT,
  embed_url             TEXT,
  thumbnail_url         TEXT,
  transcript            JSONB,                                       -- { language, segments: [{start,end,text}] }
  transcript_source     TEXT DEFAULT 'whisper',                      -- 'whisper' | 'uploaded'
  transcription_cost_usd NUMERIC(10,4),                              -- audit trail
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, source_video_id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_number ON lessons(course_id, lesson_number);


-- Materials (PDFs, MDs, texts — non-video knowledge base) ---------------------

CREATE TABLE IF NOT EXISTS materials (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id     UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,                                       -- 'pdf' | 'markdown' | 'text'
  name          TEXT NOT NULL,
  storage_path  TEXT NOT NULL,                                       -- Supabase Storage path
  size_bytes    BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);


-- Chunks (unified vector index over lessons + materials) ---------------------

CREATE TABLE IF NOT EXISTS chunks (
  id            BIGSERIAL PRIMARY KEY,
  course_id     UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL,                                       -- 'lesson' | 'material'
  lesson_id     UUID REFERENCES lessons(id) ON DELETE CASCADE,
  material_id   UUID REFERENCES materials(id) ON DELETE CASCADE,
  start_sec     REAL,
  end_sec       REAL,
  text          TEXT NOT NULL,
  embedding     vector(384) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((source_type = 'lesson'   AND lesson_id   IS NOT NULL AND material_id IS NULL)
      OR (source_type = 'material' AND material_id IS NOT NULL AND lesson_id   IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_chunks_course   ON chunks(course_id);
CREATE INDEX IF NOT EXISTS idx_chunks_lesson   ON chunks(lesson_id)   WHERE lesson_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_material ON chunks(material_id) WHERE material_id IS NOT NULL;

-- HNSW vector index — much faster cosine queries than seq scan at any non-trivial size.
-- m=16, ef_construction=64 are reasonable defaults; tune later if recall isn't enough.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);


-- Students (alunos) -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS students (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  hotmart_buyer_id  TEXT,
  display_name      TEXT,
  last_active_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_students_tenant  ON students(tenant_id);
CREATE INDEX IF NOT EXISTS idx_students_active  ON students(tenant_id, last_active_at);


-- Course access (which courses each student can use) -------------------------

CREATE TABLE IF NOT EXISTS course_access (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  source      TEXT NOT NULL,                                         -- 'hotmart_webhook' | 'manual' | 'imported'
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_access_student ON course_access(student_id)  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_course_access_course  ON course_access(course_id)   WHERE revoked_at IS NULL;


-- Student progress -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_progress (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id           UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  last_position_sec   INT NOT NULL DEFAULT 0,
  total_watched_sec   INT NOT NULL DEFAULT 0,
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_student ON student_progress(student_id);


-- OAuth (we are the Authorization Server for MCP clients) --------------------

CREATE TABLE IF NOT EXISTS oauth_clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,    -- NULL = global client (e.g. our submitted app)
  client_id       TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  redirect_uris   TEXT[] NOT NULL DEFAULT '{}',
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash    TEXT PRIMARY KEY,                                     -- SHA-256 of raw token
  client_id     TEXT NOT NULL,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_student ON oauth_access_tokens(student_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_access_tokens_expires ON oauth_access_tokens(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash      TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  rotated_to      TEXT                                                -- rotation: hash of new refresh
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash     TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  redirect_uri  TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  code_challenge       TEXT,                                          -- PKCE S256
  code_challenge_method TEXT,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);

-- Magic links for passwordless student login -------------------------------

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash    TEXT PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  intent        TEXT NOT NULL,                                        -- 'oauth_login' | 'dashboard'
  oauth_state   TEXT,                                                 -- to resume OAuth flow after click
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at) WHERE consumed_at IS NULL;


-- Usage events (billing + audit) ---------------------------------------------

CREATE TABLE IF NOT EXISTS usage_events (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  -- types: 'transcription_minute' | 'course_ingested' | 'student_active'
  --      | 'kb_bytes_added' | 'tool_call' | 'whisper_cost_usd'
  amount        NUMERIC NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_time ON usage_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type        ON usage_events(tenant_id, type, occurred_at DESC);


-- Tool calls (analytics) -----------------------------------------------------

CREATE TABLE IF NOT EXISTS tool_calls (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id    UUID REFERENCES students(id) ON DELETE SET NULL,
  course_id     UUID REFERENCES courses(id) ON DELETE SET NULL,
  tool_name     TEXT NOT NULL,
  input         JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB,                                               -- truncated for analytics
  latency_ms    INT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tenant_time   ON tool_calls(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_course_tool   ON tool_calls(course_id, tool_name, occurred_at DESC);


-- Search queries (semantic clustering analytics) -----------------------------

CREATE TABLE IF NOT EXISTS search_queries (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  student_id        UUID REFERENCES students(id) ON DELETE SET NULL,
  query             TEXT NOT NULL,
  query_embedding   vector(384) NOT NULL,
  result_lesson_ids UUID[] NOT NULL DEFAULT '{}',
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_tenant_time ON search_queries(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_embedding   ON search_queries USING hnsw (query_embedding vector_cosine_ops);


-- Rate limit buckets (token bucket per key per hour-window) ------------------

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key           TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(window_start);


-- Helpers --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated  ON tenants;
DROP TRIGGER IF EXISTS trg_courses_updated  ON courses;
DROP TRIGGER IF EXISTS trg_lessons_updated  ON lessons;

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_courses_updated BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lessons_updated BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
