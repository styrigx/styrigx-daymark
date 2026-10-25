-- 0005：daily_pick.set_by 的取值 'owner' → 'admin'（跟进主站认证改名：管理员「设为今日」现在写 'admin'）。
-- CI 在部署 core 之前跑（deploy-core：d1 migrations apply styrigx-daymark-core --remote）。
-- set_by 没有 CHECK 约束，默认值是 'auto'（与 'owner' 无关），不用重建表，只改已存的行；
-- 只动 set_by = 'owner' 的行，day / quote_id / set_at 原样保留；重复跑结果不变。
UPDATE daily_pick SET set_by = 'admin' WHERE set_by = 'owner';
