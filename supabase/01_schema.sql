-- Dealer App MVP: step 1 (tables + sale-saving function)
-- Run in Supabase SQL editor.

-- ---------- shared: updated_at trigger ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- products ----------
create table products (
  id                integer generated always as identity primary key,
  user_id           uuid default auth.uid(),
  name              varchar(100) not null,
  pieces_per_carton integer not null check (pieces_per_carton > 0),
  unit_buy_price    numeric(12,4) not null check (unit_buy_price >= 0),
  unit_mrp          numeric(12,2) check (unit_mrp >= 0),
  status            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- ---------- shops ----------
create table shops (
  id         integer generated always as identity primary key,
  user_id    uuid default auth.uid(),
  name       varchar(100) not null,
  status     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- unique name, case-insensitive, ignoring soft-deleted rows
create unique index shops_name_uq on shops (lower(name)) where deleted_at is null;

-- ---------- sales ----------
create table sales (
  id           integer generated always as identity primary key,
  user_id      uuid default auth.uid(),
  shop_id      integer not null references shops(id),
  sale_date    date not null default (now() at time zone 'Asia/Dhaka')::date,
  paid_amount  numeric(12,2) not null default 0 check (paid_amount >= 0),
  cancelled_at timestamptz,
  status       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index sales_shop_idx on sales (shop_id);
create index sales_date_idx on sales (sale_date);

-- ---------- sale_items ----------
create table sale_items (
  id              integer generated always as identity primary key,
  user_id         uuid default auth.uid(),
  sale_id         integer not null references sales(id),
  product_id      integer not null references products(id),
  qty_pieces      integer not null check (qty_pieces > 0),
  unit_sell_price numeric(12,2) not null check (unit_sell_price >= 0),
  unit_buy_price  numeric(12,4) not null check (unit_buy_price >= 0), -- copied at sale time
  status          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index sale_items_sale_idx on sale_items (sale_id);

-- ---------- payments (paying an old due) ----------
create table payments (
  id         integer generated always as identity primary key,
  user_id    uuid default auth.uid(),
  shop_id    integer not null references shops(id),
  amount     numeric(12,2) not null check (amount > 0),
  pay_date   date not null default (now() at time zone 'Asia/Dhaka')::date,
  status     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index payments_shop_idx on payments (shop_id);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['products','shops','sales','sale_items','payments'] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- view: total, paid, due, profit per sale (due is never typed) ----------
create view sales_summary with (security_invoker = true) as
select
  s.id,
  s.shop_id,
  s.sale_date,
  s.paid_amount,
  coalesce(sum(i.qty_pieces * i.unit_sell_price), 0)::numeric(12,2)   as total,
  (coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) - s.paid_amount)::numeric(12,2) as due,
  coalesce(sum(i.qty_pieces * (i.unit_sell_price - i.unit_buy_price)), 0)::numeric(12,2) as profit
from sales s
left join sale_items i on i.sale_id = s.id and i.deleted_at is null
where s.cancelled_at is null and s.deleted_at is null
group by s.id;

-- ---------- create_sale: sale + lines in one transaction ----------
-- p_items: [{"product_id": 1, "qty_pieces": 24, "unit_sell_price": 10.00}, ...]
-- p_paid_amount: null = paid in full
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
  v_sale_id integer;
  v_total   numeric(12,2);
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
       or x.unit_sell_price is null or x.unit_sell_price < 0
  ) then
    raise exception 'Every line needs a product, quantity above 0, and a sell price';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id int)
    left join products p on p.id = x.product_id and p.deleted_at is null
    where p.id is null
  ) then
    raise exception 'Unknown product in lines';
  end if;

  select sum(x.qty_pieces * x.unit_sell_price)::numeric(12,2) into v_total
  from jsonb_to_recordset(p_items)
    as x(product_id int, qty_pieces int, unit_sell_price numeric);

  v_paid := coalesce(p_paid_amount, v_total);
  if v_paid < 0 or v_paid > v_total then
    raise exception 'Paid amount must be between 0 and the sale total';
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
