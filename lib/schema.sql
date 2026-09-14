-- Kanji Path schema (Neon Postgres)
-- Run in the Neon SQL Editor once.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS joyo_vocabulary (
  id      INTEGER PRIMARY KEY,
  word    TEXT NOT NULL,
  reading TEXT,
  meaning TEXT,
  kanji   TEXT
);

CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_word ON joyo_vocabulary(word);
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_kanji ON joyo_vocabulary(kanji);

CREATE TABLE IF NOT EXISTS game_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kanji_progress (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kanji       TEXT NOT NULL,
  write_count INTEGER NOT NULL DEFAULT 0,
  set_id      INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kanji)
);

-- Overall learning progress shown on the home dashboard
CREATE TABLE IF NOT EXISTS user_progress (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  words_learned    INTEGER NOT NULL DEFAULT 0,
  kanji_learned    INTEGER NOT NULL DEFAULT 0,
  hiragana_learned INTEGER NOT NULL DEFAULT 0,
  katakana_learned INTEGER NOT NULL DEFAULT 0,
  total_target     INTEGER NOT NULL DEFAULT 20000,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-character kana (hiragana / katakana) writing progress
CREATE TABLE IF NOT EXISTS kana_progress (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character   TEXT NOT NULL,
  script      TEXT NOT NULL CHECK (script IN ('hiragana', 'katakana')),
  write_count INTEGER NOT NULL DEFAULT 0,
  mastered    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, character, script)
);

CREATE INDEX IF NOT EXISTS idx_kana_progress_user ON kana_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_kana_progress_script ON kana_progress(script);

-- Optional: store path / SRS state server-side (synced from localStorage)
CREATE TABLE IF NOT EXISTS path_progress (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kanji      TEXT NOT NULL,
  stage      INTEGER NOT NULL DEFAULT 0,
  ease       REAL NOT NULL DEFAULT 2.5,
  interval   INTEGER NOT NULL DEFAULT 0,
  due_at     TIMESTAMPTZ,
  reps       INTEGER NOT NULL DEFAULT 0,
  lapses     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kanji)
);

CREATE INDEX IF NOT EXISTS idx_path_progress_due ON path_progress(user_id, due_at);
