-- Dealer App MVP: step 7 (stock)
-- - company_payments: money you prepay to the company
-- - receipts + receipt_items: each delivery (memo vs what actually arrived)
-- - product_stock: received - sold, per product
-- - company_balance: prepaid - memo amounts (advance left with the company)
-- Run in Supabase SQL editor after 06.

-- ---------- company_payments ----------
create table company_payments (
  id         integer generated always as identity primary key,
  user_id    uuid default auth.uid(),
  pay_date   date not null default (now() at time zone 'Asia/Dhaka')::date,
  amount     numeric(12,2) not null check (amount > 0),
  note       varchar(200),
  status     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- receipts (one per delivery / memo) ----------
create table receipts (
  id           integer generated always as identity primary key,
  user_id      uuid default auth.uid(),
  receive_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  memo_no      varchar(50),
  memo_amount  numeric(12,2) not null default 0 check (memo_amount >= 0), -- what the company charged
  driver_name  varchar(100),
  driver_paid  numeric(12,2) not null default 0 check (driver_paid >= 0), -- taken from driver for missing goods
  note         varchar(200),
  status       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index receipts_date_idx on receipts (receive_date);

-- ---------- receipt_items ----------
create table receipt_items (
  id                  integer generated always as identity primary key,
  user_id             uuid default auth.uid(),
  receipt_id          integer not null references receipts(id),
  product_id          integer not null references products(id),
  memo_qty_pieces     integer not null check (memo_qty_pieces >= 0),
  received_qty_pieces integer not null check (received_qty_pieces >= 0),
  unit_buy_price      numeric(12,4) not null check (unit_buy_price >= 0), -- copied at receive time
  status              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (memo_qty_pieces > 0 or received_qty_pieces > 0)
);
create index receipt_items_receipt_idx on receipt_items (receipt_id);
create index receipt_items_product_idx on receipt_items (product_id);
create index sale_items_product_idx on sale_items (product_id);

-- ---------- updated_at triggers + RLS (same pattern as 01/02) ----------
do $$
declare t text;
begin
  foreach t in array array['company_payments','receipts','receipt_items'] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
       for each row execute function set_updated_at()', t, t);
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "own rows" on %I for all to authenticated
       using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- view: stock per product (pieces) ----------
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

-- ---------- view: per delivery, with shortage ----------
create view receipts_summary with (security_invoker = true) as
select
  r.id, r.receive_date, r.memo_no, r.memo_amount, r.driver_name, r.driver_paid, r.note,
  coalesce(sum(greatest(i.memo_qty_pieces - i.received_qty_pieces, 0)), 0)::integer as short_pieces,
  coalesce(sum(greatest(i.memo_qty_pieces - i.received_qty_pieces, 0) * i.unit_buy_price), 0)::numeric(12,2) as short_value
from receipts r
left join receipt_items i on i.receipt_id = r.id and i.deleted_at is null
where r.deleted_at is null
group by r.id;

-- ---------- view: money with the company ----------
create view company_balance with (security_invoker = true) as
select
  coalesce((select sum(amount) from company_payments where deleted_at is null), 0)::numeric(12,2) as paid,
  coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0)::numeric(12,2) as charged,
  (coalesce((select sum(amount) from company_payments where deleted_at is null), 0)
   - coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0))::numeric(12,2) as balance;

-- ---------- create_receipt: delivery + lines in one transaction ----------
-- p_items: [{"product_id": 1, "memo_qty_pieces": 480, "received_qty_pieces": 470}, ...]
create or replace function create_receipt(
  p_receive_date date,
  p_memo_no      text,
  p_memo_amount  numeric,
  p_driver_name  text,
  p_driver_paid  numeric,
  p_note         text,
  p_items        jsonb
) returns integer
language plpgsql
security invoker
as $$
declare
  v_id integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items)
      as x(product_id int, memo_qty_pieces int, received_qty_pieces int)
    where x.product_id is null
       or coalesce(x.memo_qty_pieces, -1) < 0 or coalesce(x.received_qty_pieces, -1) < 0
       or (x.memo_qty_pieces = 0 and x.received_qty_pieces = 0)
  ) then
    raise exception 'Every line needs a product and a quantity';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id int)
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
    as x(product_id int, memo_qty_pieces int, received_qty_pieces int)
  join products p on p.id = x.product_id;

  return v_id;
end $$;
