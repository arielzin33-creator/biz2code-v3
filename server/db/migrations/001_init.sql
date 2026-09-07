-- biz2code — PostgreSQL schema
-- Raw SQL by design (ADR-004). Migrations are hand-written, numbered files.
-- Apply in order: psql -f 001_init.sql

-- ---------------------------------------------------------------- users ---
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- projects ---
-- One business idea moving through the pipeline.
CREATE TABLE projects (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  vertical_id    TEXT,                      -- FK-by-convention to benchmarks/taxonomy.json
  business_model TEXT,
  current_phase  INTEGER NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 4),
  status         TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress','complete','archived')),
  is_seed        BOOLEAN NOT NULL DEFAULT FALSE,   -- the pre-filled demo project
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_user ON projects(user_id);

-- --------------------------------------------------------------- phases ---
-- One row per project per phase. THIS TABLE IS THE GATE.
CREATE TABLE phases (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_no    INTEGER NOT NULL CHECK (phase_no BETWEEN 1 AND 4),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','awaiting_approval','approved','revising')),
  approved_at TIMESTAMPTZ,
  UNIQUE (project_id, phase_no),
  -- A phase cannot be approved without an approval timestamp.
  CONSTRAINT approved_needs_timestamp
    CHECK (status <> 'approved' OR approved_at IS NOT NULL)
);
CREATE INDEX idx_phases_project ON phases(project_id);

-- ------------------------------------------------------------- answers ---
-- question_id references question-bank.json (seeded, not a DB table — ADR-006).
CREATE TABLE answers (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL,
  phase_no     INTEGER NOT NULL CHECK (phase_no BETWEEN 1 AND 4),
  value_text   TEXT,
  value_number NUMERIC,
  value_json   JSONB,           -- multiselect
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, question_id)
);
CREATE INDEX idx_answers_project ON answers(project_id);

-- -------------------------------------------------------- deliverables ---
-- One row PER VERSION (ADR-007): revising never overwrites.
CREATE TABLE deliverables (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('mrd','prd','business_plan')),
  version        INTEGER NOT NULL CHECK (version >= 1),
  content_json   JSONB NOT NULL,   -- section-keyed generated text
  file_path      TEXT,             -- e.g. outputs/<project>/MRD_v1.docx
  provenance     JSONB NOT NULL,   -- which answers/benchmarks/API calls fed each field
  unvalidated    JSONB,            -- fields rendered "unvalidated" and why
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, doc_type, version)
);
CREATE INDEX idx_deliverables_project ON deliverables(project_id);

-- ------------------------------------------------------- external_cache ---
-- Caches World Bank / iTunes responses. Keeps the demo fast and offline-safe.
CREATE TABLE external_cache (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('worldbank','itunes')),
  cache_key   TEXT NOT NULL,
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, cache_key)
);
