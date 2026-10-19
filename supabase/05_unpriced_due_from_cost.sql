-- Dealer App MVP: step 5
-- A sale with no sell prices is owed at least its buy cost:
--   due    = max(cost - collected, 0)
--   profit = max(collected - cost, 0)
-- Priced sales are unchanged. Run in Supabase SQL editor after 04.
-- (shop_balances reads sales_summary.due, so it needs no change; it is
--  dropped and recreated only because it depends on the view.)

drop view shop_balances;
drop view sales_summary;

create view sales_summary with (security_invoker = true) as
select
  s.id,
  s.shop_id,
  s.sale_date,
  s.paid_amount,
  coalesce(sum(i.qty_pieces * i.unit_buy_price), 0)::numeric(12,2) as cost,
  -- null when any line has no sell price (flag for the app)
  case when count(i.id) = count(i.unit_sell_price)
       then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) end::numeric(12,2) as total,
  (case when count(i.id) = count(i.unit_sell_price)
        then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) - s.paid_amount
        else greatest(coalesce(sum(i.qty_pieces * i.unit_buy_price), 0) - s.paid_amount, 0)
   end)::numeric(12,2) as due,
  (case when count(i.id) = count(i.unit_sell_price)
        then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0)
             - coalesce(sum(i.qty_pieces * i.unit_buy_price), 0)
        else greatest(s.paid_amount - coalesce(sum(i.qty_pieces * i.unit_buy_price), 0), 0)
   end)::numeric(12,2) as profit
from sales s
left join sale_items i on i.sale_id = s.id and i.deleted_at is null
where s.cancelled_at is null and s.deleted_at is null
group by s.id;

create view shop_balances with (security_invoker = true) as
select
  sh.id as shop_id,
  (coalesce((select sum(ss.due) from sales_summary ss where ss.shop_id = sh.id), 0)
   - coalesce((select sum(p.amount) from payments p
               where p.shop_id = sh.id and p.deleted_at is null and p.status), 0)
  )::numeric(12,2) as balance
from shops sh
where sh.deleted_at is null;
