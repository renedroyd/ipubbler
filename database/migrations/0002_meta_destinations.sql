PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS facebook_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  facebook_account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('page','profile','group')),
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(facebook_account_id, type, provider_id),
  FOREIGN KEY (facebook_account_id) REFERENCES facebook_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_destinations (
  post_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','published','failed')),
  provider_post_id TEXT,
  error_message TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, destination_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (destination_id) REFERENCES destinations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_facebook_accounts_user_id ON facebook_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_destinations_account_id ON destinations(facebook_account_id);
CREATE INDEX IF NOT EXISTS idx_post_destinations_destination_id ON post_destinations(destination_id);
CREATE INDEX IF NOT EXISTS idx_post_destinations_status ON post_destinations(status);
