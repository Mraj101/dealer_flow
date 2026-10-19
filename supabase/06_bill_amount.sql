-- Dealer App MVP: step 6 (bill amount)
-- The shop's real bill for a sale, typed once instead of a price on every line.
--   total  = bill_amount, else sum of line sell prices (when every line has one)
--   due    = total - collected
--   profit = total - cost
-- Old sales with neither keep the step-5 fallback (due/profit against buy cost).
-- Run in Supabase SQL editor after 05.

alter table sales
  add column bill_amount numeric(12,2) check (bill_amount >= 0);

drop view shop_balances;
drop view sales_summary;

create view sales_summary with (security_invoker = true) as
select
  x.id, x.shop_id, x.sale_date, x.paid_amount, x.cost, x.total,
  (case when x.total is not null then x.total - x.paid_amount
        else greatest(x.cost - x.paid_amount, 0) end)::numeric(12,2) as due,
  (case when x.total is not null then x.total - x.cost
        else greatest(x.paid_amount - x.cost, 0) end)::numeric(12,2) as profit
from (
  select
    s.id,
    s.shop_id,
    s.sale_date,
    s.paid_amount,
    coalesce(sum(i.qty_pieces * i.unit_buy_price), 0)::numeric(12,2) as cost,
    -- null = no bill and not every line priced (old sales only)
    coalesce(
      s.bill_amount,
      case when count(i.id) = count(i.unit_sell_price)
           then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) end
    )::numeric(12,2) as total
  from sales s
  left join sale_items i on i.sale_id = s.id and i.deleted_at is null
  where s.cancelled_at is null and s.deleted_at is null
  group by s.id
) x;

create view shop_balances with (security_invoker = true) as
select
  sh.id as shop_id,
  (coalesce((select sum(ss.due) from sales_summary ss where ss.shop_id = sh.id), 0)
   - coalesce((select sum(p.amount) from payments p
               where p.shop_id = sh.id and p.deleted_at is null and p.status), 0)
  )::numeric(12,2) as balance
from shops sh
where sh.deleted_at is null;

-- ---------- create_sale: now takes the bill amount ----------
drop function create_sale(integer, date, numeric, jsonb);

-- p_items: [{"product_id": 1, "qty_pieces": 24, "unit_sell_price": 10.00 | null}, ...]
-- p_bill_amount: what the shop owes for this sale; null = sum of line prices (every line needs one)
-- p_paid_amount: money collected now; null = paid in full
create or replace function create_sale(
  p_shop_id     integer,
  p_sale_date   date,
  p_bill_amount numeric,
  p_paid_amount numeric,
  p_items       jsonb
) returns integer
language plpgsql
security invoker
as $$
declare
  v_sale_id integer;
  v_bill    numeric(12,2);
  v_paid    numeric(12,2);
begin
  if not exists (select 1 from shops where id = p_shop_id and deleted_at is null) then
    raise exception 'Shop not found';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one line';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(product_id int, qty_pieces int, unit_sell_price numeric)
    where x.product_id is null or coalesce(x.qty_pieces, 0) <= 0
       or x.unit_sell_price < 0
  ) then
    raise exception 'Every line needs a product and quantity above 0';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id int)
    left join products p on p.id = x.product_id and p.deleted_at is null
    where p.id is null
  ) then
    raise exception 'Unknown product in lines';
  end if;

  if p_bill_amount is not null then
    v_bill := p_bill_amount;
  else
    -- sum of line prices; null if any line has no price
    select case when bool_or(x.unit_sell_price is null) then null
                else sum(x.qty_pieces * x.unit_sell_price) end
      into v_bill
    from jsonb_to_recordset(p_items)
      as x(product_id int, qty_pieces int, unit_sell_price numeric);
  end if;

  if v_bill is null or v_bill < 0 then
    raise exception 'Enter the bill amount';
  end if;

  v_paid := coalesce(p_paid_amount, v_bill);
  if v_paid < 0 or v_paid > v_bill then
    raise exception 'Money collected must be between 0 and the bill amount';
  end if;

  insert into sales (shop_id, sale_date, bill_amount, paid_amount)
  values (p_shop_id, coalesce(p_sale_date, (now() at time zone 'Asia/Dhaka')::date), v_bill, v_paid)
  returning id into v_sale_id;

  insert into sale_items (sale_id, product_id, qty_pieces, unit_sell_price, unit_buy_price)
  select v_sale_id, x.product_id, x.qty_pieces, x.unit_sell_price, p.unit_buy_price
  from jsonb_to_recordset(p_items)
    as x(product_id int, qty_pieces int, unit_sell_price numeric)
  join products p on p.id = x.product_id;

  return v_sale_id;
end $$;
