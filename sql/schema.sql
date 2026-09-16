-- Japanese Flashcards Review schema for Neon/Postgres
-- Run once in the Neon SQL Editor. Safe for an existing scores table.

CREATE TABLE IF NOT EXISTS scores (
  id             BIGSERIAL PRIMARY KEY,
  nick           TEXT NOT NULL CHECK (char_length(nick) BETWEEN 3 AND 12),
  when_ts        BIGINT NOT NULL,
  right_count    INTEGER NOT NULL DEFAULT 0,
  wrong_count    INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  pct            INTEGER NOT NULL DEFAULT 0,
  grade          CHAR(1) NOT NULL DEFAULT 'F' CHECK (grade IN ('A','B','C','D','F')),
  attempts       INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  completed      BOOLEAN NOT NULL DEFAULT TRUE,
    reason TEXT,
    score_percentage NUMERIC(5,2),
  duration_ms    BIGINT NOT NULL DEFAULT 0,
  lessons        TEXT,
  dir            TEXT DEFAULT 'jp-en',
  timer          INTEGER DEFAULT 5,
  mistakes_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrects_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scores ADD COLUMN IF NOT EXISTS grade CHAR(1) DEFAULT 'F';
ALTER TABLE scores ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 1;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT TRUE;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS duration_ms BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS scores_when_ts_idx ON scores (when_ts DESC);
CREATE INDEX IF NOT EXISTS scores_nick_idx ON scores (lower(nick));
CREATE INDEX IF NOT EXISTS scores_grade_idx ON scores (grade);
