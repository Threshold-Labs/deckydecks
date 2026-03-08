-- DeckyDecks D1 Schema

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  deck_title TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  path TEXT,
  branch_decisions TEXT,
  last_node TEXT,
  completed INTEGER DEFAULT 0,
  dwell_times TEXT,
  engaged_times TEXT,
  idle_times TEXT,
  device_id TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  deck_title TEXT,
  current_node TEXT,
  text TEXT NOT NULL,
  path_taken TEXT,
  branch_choices TEXT,
  timestamp TEXT,
  device_id TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  title TEXT,
  node_count INTEGER,
  r2_key TEXT NOT NULL,
  device_id TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_deck ON feedback(deck_title);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_deck ON sessions(deck_title);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);
CREATE INDEX IF NOT EXISTS idx_decks_device ON decks(device_id);
