PRAGMA foreign_keys = ON;

-- Explicit leases prevent posts/destinations from remaining in `processing`
-- forever after a Worker invocation is interrupted.
ALTER TABLE posts ADD COLUMN processing_at TEXT;
ALTER TABLE post_destinations ADD COLUMN processing_at TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_processing_at ON posts(status, processing_at);
CREATE INDEX IF NOT EXISTS idx_post_destinations_processing_at ON post_destinations(status, processing_at);
