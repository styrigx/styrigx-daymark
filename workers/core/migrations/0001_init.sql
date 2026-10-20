-- 日刻：句子表。代码里也有 CREATE TABLE IF NOT EXISTS 兜底（src/api/_quotes.js）。
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  trans TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quotes_created ON quotes (created_at);
