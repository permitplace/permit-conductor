CREATE TABLE IF NOT EXISTS permit_projects (
  id          TEXT PRIMARY KEY,
  stage       TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permit_projects_stage ON permit_projects(stage);
