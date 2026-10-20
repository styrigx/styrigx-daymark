-- 日刻三页签（余响 · 拾录 · 百味）：句子加出处类型、随手一笔；百味的自建专题和专题里的句子顺序。
-- CI 在部署 core 之前跑（deploy-core：d1 migrations apply styrigx-daymark --remote）。
-- source_type：'' | poetry | book | film | song | interview | mine
-- note：随手一笔，只给主人看，访客接口和 /api/today 一律不返回
ALTER TABLE quotes ADD COLUMN source_type TEXT NOT NULL DEFAULT '';
ALTER TABLE quotes ADD COLUMN note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_quotes (
  collection_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, quote_id)
);
CREATE INDEX IF NOT EXISTS collection_quotes_quote ON collection_quotes (quote_id);
