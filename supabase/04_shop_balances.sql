-- Dealer App MVP: step 4 (collect old dues)
-- balance = sum of due on priced sales - payments received later
-- Run in Supabase SQL editor after 03.

create view shop_balances with (security_invoker = true) as
select
  sh.id as shop_id,
  (coalesce((select sum(ss.due) from sales_summary ss where ss.shop_id = sh.id), 0)
   - coalesce((select sum(p.amount) from payments p
               where p.shop_id = sh.id and p.deleted_at is null and p.status), 0)
  )::numeric(12,2) as balance
from shops sh
where sh.deleted_at is null;
