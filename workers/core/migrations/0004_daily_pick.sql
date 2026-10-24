-- 0004：锁定今日一句（daily_pick）。
-- 每个北京时间日期一行：当天第一次请求 /api/today 时挑好写进来（set_by='auto'），之后当天都读这一行，
-- 新增句子不再让当天的句子变；主人在余响「设为今日」会改写当天这一行（set_by='owner'）。
-- 只建新表，不动 quotes / collections；IF NOT EXISTS：与 src/api/_quotes.js 的兜底建表一致，重复跑也不报错。
CREATE TABLE IF NOT EXISTS daily_pick (
  day TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  set_by TEXT NOT NULL DEFAULT 'auto',
  set_at INTEGER NOT NULL DEFAULT 0
);
