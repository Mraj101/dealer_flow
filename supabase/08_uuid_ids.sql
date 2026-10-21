-- Dealer App: step 8 (UUID ids, for offline-first)
-- Every table's integer id becomes a uuid, so the phone can create rows offline
-- without clashing with the server. Existing rows are kept; every link between
-- tables (sale -> shop, item -> product, ...) is remapped to the new ids.
--
-- BREAKING: the app's code must be the matching version (ids are strings now,
-- create_sale / create_receipt take uuid). Deploy the code and run this together.
-- Run ONCE, after 07. It is one transaction: if anything fails, nothing changes.

begin;

-- ---------- 1) drop what depends on the old integer ids ----------
drop view if exists shop_balances;
drop view if exists sales_summary;
drop view if exists product_stock;
drop view if exists receipts_summary;
drop view if exists company_balance;
drop function if exists create_sale(integer, date, numeric, numeric, jsonb);
drop function if exists create_receipt(date, text, numeric, text, numeric, text, jsonb);

-- ---------- 2) new uuid id on every table ----------
alter table products         add column new_id uuid not null default gen_random_uuid();
alter table shops            add column new_id uuid not null default gen_random_uuid();
alter table sales            add column new_id uuid not null default gen_random_uuid();
alter table sale_items       add column new_id uuid not null default gen_random_uuid();
alter table payments         add column new_id uuid not null default gen_random_uuid();
alter table company_payments add column new_id uuid not null default gen_random_uuid();
alter table receipts         add column new_id uuid not null default gen_random_uuid();
alter table receipt_items    add column new_id uuid not null default gen_random_uuid();

-- ---------- 3) remap every link to the new ids ----------
alter table sales         add column new_shop_id    uuid;
alter table sale_items    add column new_sale_id    uuid;
alter table sale_items    add column new_product_id uuid;
alter table payments      add column new_shop_id    uuid;
alter table receipt_items add column new_receipt_id uuid;
alter table receipt_items add column new_product_id uuid;

update sales         t set new_shop_id    = p.new_id from shops    p where p.id = t.shop_id;
update sale_items    t set new_sale_id    = p.new_id from sales    p where p.id = t.sale_id;
update sale_items    t set new_product_id = p.new_id from products p where p.id = t.product_id;
update payments      t set new_shop_id    = p.new_id from shops    p where p.id = t.shop_id;
update receipt_items t set new_receipt_id = p.new_id from receipts p where p.id = t.receipt_id;
update receipt_items t set new_product_id = p.new_id from products p where p.id = t.product_id;

alter table sales         alter column new_shop_id    set not null;
alter table sale_items    alter column new_sale_id    set not null;
alter table sale_items    alter column new_product_id set not null;
alter table payments      alter column new_shop_id    set not null;
alter table receipt_items alter column new_receipt_id set not null;
alter table receipt_items alter column new_product_id set not null;

-- ---------- 4) drop the old integer columns (this also drops their FKs and indexes) ----------
alter table sales         drop column shop_id;
alter table sale_items    drop column sale_id, drop column product_id;
alter table payments      drop column shop_id;
alter table receipt_items drop column receipt_id, drop column product_id;

alter table products         drop column id;
alter table shops            drop column id;
alter table sales            drop column id;
alter table sale_items       drop column id;
alter table payments         drop column id;
alter table company_payments drop column id;
alter table receipts         drop column id;
alter table receipt_items    drop column id;

-- ---------- 5) new columns take over the names ----------
alter table products         rename column new_id to id;
alter table shops            rename column new_id to id;
alter table sales            rename column new_id to id;
alter table sale_items       rename column new_id to id;
alter table payments         rename column new_id to id;
alter table company_payments rename column new_id to id;
alter table receipts         rename column new_id to id;
alter table receipt_items    rename column new_id to id;

alter table sales         rename column new_shop_id    to shop_id;
alter table sale_items    rename column new_sale_id    to sale_id;
alter table sale_items    rename column new_product_id to product_id;
alter table payments      rename column new_shop_id    to shop_id;
alter table receipt_items rename column new_receipt_id to receipt_id;
alter table receipt_items rename column new_product_id to product_id;

-- ---------- 6) keys, links, indexes ----------
alter table products         add primary key (id);
alter table shops            add primary key (id);
alter table sales            add primary key (id);
alter table sale_items       add primary key (id);
alter table payments         add primary key (id);
alter table company_payments add primary key (id);
alter table receipts         add primary key (id);
alter table receipt_items    add primary key (id);

alter table sales         add foreign key (shop_id)    references shops(id);
alter table sale_items    add foreign key (sale_id)    references sales(id);
alter table sale_items    add foreign key (product_id) references products(id);
alter table payments      add foreign key (shop_id)    references shops(id);
alter table receipt_items add foreign key (receipt_id) references receipts(id);
alter table receipt_items add foreign key (product_id) references products(id);

create index sales_shop_idx          on sales (shop_id);
create index sale_items_sale_idx     on sale_items (sale_id);
create index sale_items_product_idx  on sale_items (product_id);
create index payments_shop_idx       on payments (shop_id);
create index receipt_items_receipt_idx on receipt_items (receipt_id);
create index receipt_items_product_idx on receipt_items (product_id);

-- ---------- 7) views (same logic as 06 / 07, uuid ids) ----------
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

create view product_stock with (security_invoker = true) as
select
  p.id as product_id,
  coalesce((select sum(ri.received_qty_pieces)
            from receipt_items ri
            join receipts r on r.id = ri.receipt_id and r.deleted_at is null
            where ri.product_id = p.id and ri.deleted_at is null), 0)::integer as received_pieces,
  coalesce((select sum(si.qty_pieces)
            from sale_items si
            join sales s on s.id = si.sale_id
              and s.deleted_at is null and s.cancelled_at is null
            where si.product_id = p.id and si.deleted_at is null), 0)::integer as sold_pieces
from products p
where p.deleted_at is null;

create view receipts_summary with (security_invoker = true) as
select
  r.id, r.receive_date, r.memo_no, r.memo_amount, r.driver_name, r.driver_paid, r.note,
  coalesce(sum(greatest(i.memo_qty_pieces - i.received_qty_pieces, 0)), 0)::integer as short_pieces,
  coalesce(sum(greatest(i.memo_qty_pieces - i.received_qty_pieces, 0) * i.unit_buy_price), 0)::numeric(12,2) as short_value
from receipts r
left join receipt_items i on i.receipt_id = r.id and i.deleted_at is null
where r.deleted_at is null
group by r.id;

create view company_balance with (security_invoker = true) as
select
  coalesce((select sum(amount) from company_payments where deleted_at is null), 0)::numeric(12,2) as paid,
  coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0)::numeric(12,2) as charged,
  (coalesce((select sum(amount) from company_payments where deleted_at is null), 0)
   - coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0))::numeric(12,2) as balance;

-- ---------- 8) functions (same logic as 06 / 07, uuid ids) ----------
-- p_items: [{"product_id": "<uuid>", "qty_pieces": 24, "unit_sell_price": 10.00 | null}, ...]
create or replace function create_sale(
  p_shop_id     uuid,
  p_sale_date   date,
  p_bill_amount numeric,
  p_paid_amount numeric,
  p_items       jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_sale_id uuid;
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
      as x(product_id uuid, qty_pieces int, unit_sell_price numeric)
    where x.product_id is null or coalesce(x.qty_pieces, 0) <= 0
       or x.unit_sell_price < 0
  ) then
    raise exception 'Every line needs a product and quantity above 0';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid)
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
      as x(product_id uuid, qty_pieces int, unit_sell_price numeric);
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
    as x(product_id uuid, qty_pieces int, unit_sell_price numeric)
  join products p on p.id = x.product_id;

  return v_sale_id;
end $$;

-- p_items: [{"product_id": "<uuid>", "memo_qty_pieces": 480, "received_qty_pieces": 470}, ...]
create or replace function create_receipt(
  p_receive_date date,
  p_memo_no      text,
  p_memo_amount  numeric,
  p_driver_name  text,
  p_driver_paid  numeric,
  p_note         text,
  p_items        jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(product_id uuid, memo_qty_pieces int, received_qty_pieces int)
    where x.product_id is null
       or coalesce(x.memo_qty_pieces, -1) < 0 or coalesce(x.received_qty_pieces, -1) < 0
       or (x.memo_qty_pieces = 0 and x.received_qty_pieces = 0)
  ) then
    raise exception 'Every line needs a product and a quantity';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid)
    left join products p on p.id = x.product_id and p.deleted_at is null
    where p.id is null
  ) then
    raise exception 'Unknown product in lines';
  end if;

  if coalesce(p_memo_amount, 0) < 0 or coalesce(p_driver_paid, 0) < 0 then
    raise exception 'Amounts cannot be negative';
  end if;

  insert into receipts (receive_date, memo_no, memo_amount, driver_name, driver_paid, note)
  values (
    coalesce(p_receive_date, (now() at time zone 'Asia/Dhaka')::date),
    nullif(trim(p_memo_no), ''),
    coalesce(p_memo_amount, 0),
    nullif(trim(p_driver_name), ''),
    coalesce(p_driver_paid, 0),
    nullif(trim(p_note), '')
  )
  returning id into v_id;

  insert into receipt_items (receipt_id, product_id, memo_qty_pieces, received_qty_pieces, unit_buy_price)
  select v_id, x.product_id, x.memo_qty_pieces, x.received_qty_pieces, p.unit_buy_price
  from jsonb_to_recordset(p_items)
    as x(product_id uuid, memo_qty_pieces int, received_qty_pieces int)
  join products p on p.id = x.product_id;

  return v_id;
end $$;

commit;
