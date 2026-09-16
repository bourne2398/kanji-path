-- Review history migration
-- Run once against the existing Neon/Postgres database.

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS score_percentage NUMERIC(5,2);

-- Existing completed rows can keep their stored values.
-- For incomplete reviews, the application should save:
--   completed = FALSE
--   grade = 'F'
--   reason = 'Player quit the game'
--   score_percentage = actual percentage reached before quitting.
