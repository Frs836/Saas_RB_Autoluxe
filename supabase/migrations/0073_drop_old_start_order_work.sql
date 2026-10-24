-- 0073_drop_old_start_order_work.sql
-- Drop old single-parameter start_order_work to avoid function ambiguity with new overload
-- Problem: The old function `public.start_order_work(p_order_id uuid)` conflicted
-- with new version `public.start_order_work(p_order_id uuid, p_team_ids uuid[] DEFAULT NULL)`

DROP FUNCTION IF EXISTS public.start_order_work(uuid);