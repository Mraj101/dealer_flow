-- Dealer App MVP: step 3
-- - shops get optional area + phone; same name allowed in different areas
-- - sell price per line is optional (often only the buy price is known)
-- - profit = money collected - cost (pieces x buy price) when lines have no price
-- Run in Supabase SQL editor after 01 and 02.

-- ---------- shops: area, phone ----------
alter table shops
  add column area  varchar(100),
  add column phone varchar(20);

drop index shops_name_uq;
-- unique per user + name + area, case-insensitive, ignoring soft-deleted rows
create unique index shops_name_area_uq
  on shops (user_id, lower(name), lower(coalesce(area, '')))
  where deleted_at is null;

-- ---------- sale_items: sell price optional ----------
alter table sale_items alter column unit_sell_price drop not null;

-- ---------- view: total/due only when every line has a price ----------
drop view sales_summary;
create view sales_summary with (security_invoker = true) as
select
  s.id,
  s.shop_id,
  s.sale_date,
  s.paid_amount,
  coalesce(sum(i.qty_pieces * i.unit_buy_price), 0)::numeric(12,2) as cost,
  -- null when any line has no sell price
  case when count(i.id) = count(i.unit_sell_price)
       then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) end::numeric(12,2) as total,
  case when count(i.id) = count(i.unit_sell_price)
       then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) - s.paid_amount end::numeric(12,2) as due,
  -- priced sale: total - cost; unpriced sale: money collected - cost
  (case when count(i.id) = count(i.unit_sell_price)
        then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0)
        else s.paid_amount end
   - coalesce(sum(i.qty_pieces * i.unit_buy_price), 0))::numeric(12,2) as profit
from sales s
left join sale_items i on i.sale_id = s.id and i.deleted_at is null
where s.cancelled_at is null and s.deleted_at is null
group by s.id;

-- ---------- create_sale: sell price optional ----------
-- p_items: [{"product_id": 1, "qty_pieces": 24, "unit_sell_price": 10.00 | null}, ...]
-- p_paid_amount: money collected; null = paid in full (only allowed when every line has a price)
create or replace function create_sale(
  p_shop_id     integer,
  p_sale_date   date,
  p_paid_amount numeric,
  p_items       jsonb
) returns integer
language plpgsql
security invoker
as $$
declare
  v_sale_id  integer;
  v_total    numeric(12,2);
  v_unpriced boolean;
  v_paid     numeric(12,2);
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

  select sum(x.qty_pieces * x.unit_sell_price)::numeric(12,2),
         bool_or(x.unit_sell_price is null)
    into v_total, v_unpriced
  from jsonb_to_recordset(p_items)
    as x(product_id int, qty_pieces int, unit_sell_price numeric);

  if v_unpriced then
    if p_paid_amount is null or p_paid_amount < 0 then
      raise exception 'Enter the money collected';
    end if;
    v_paid := p_paid_amount;
  else
    v_paid := coalesce(p_paid_amount, v_total);
    if v_paid < 0 or v_paid > v_total then
      raise exception 'Paid amount must be between 0 and the sale total';
    end if;
  end if;

  insert into sales (shop_id, sale_date, paid_amount)
  values (p_shop_id, coalesce(p_sale_date, (now() at time zone 'Asia/Dhaka')::date), v_paid)
  returning id into v_sale_id;

  insert into sale_items (sale_id, product_id, qty_pieces, unit_sell_price, unit_buy_price)
  select v_sale_id, x.product_id, x.qty_pieces, x.unit_sell_price, p.unit_buy_price
  from jsonb_to_recordset(p_items)
    as x(product_id int, qty_pieces int, unit_sell_price numeric)
  join products p on p.id = x.product_id;

  return v_sale_id;
end $$;
