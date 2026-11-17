-- 目标达成日期（自设达成时间；推荐方案为 NULL，由前端按 400 kcal/天 动态计算）
ALTER TABLE goals ADD COLUMN target_date TEXT;
