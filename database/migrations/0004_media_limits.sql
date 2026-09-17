PRAGMA foreign_keys = ON;

-- Enforce the application-level maximum at the database boundary too.
-- This closes the count-then-insert race when multiple uploads arrive concurrently.
CREATE TRIGGER IF NOT EXISTS trg_media_max_per_post
BEFORE INSERT ON media
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM media WHERE post_id = NEW.post_id) >= 10
BEGIN
  SELECT RAISE(ABORT, 'media_limit_exceeded');
END;
