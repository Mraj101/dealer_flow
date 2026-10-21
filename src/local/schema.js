// One spec drives the SQLite tables and the phone <-> Supabase conversion.
// kinds: text | int | money | bool | ts
// ORDER matters for pushing: parents before children.

const common = [
  ['id', 'text'], ['user_id', 'text'],
]
const tail = [
  ['status', 'bool'], ['created_at', 'ts'], ['updated_at', 'ts'], ['deleted_at', 'ts'],
]

export const TABLES = {
  products: [
    ...common, ['name', 'text'], ['pieces_per_carton', 'int'],
    ['unit_buy_price', 'money'], ['unit_mrp', 'money'], ...tail,
  ],
  shops: [...common, ['name', 'text'], ['area', 'text'], ['phone', 'text'], ...tail],
  company_payments: [
    ...common, ['pay_date', 'text'], ['amount', 'money'], ['note', 'text'], ...tail,
  ],
  receipts: [
    ...common, ['receive_date', 'text'], ['memo_no', 'text'], ['memo_amount', 'money'],
    ['driver_name', 'text'], ['driver_paid', 'money'], ['note', 'text'], ...tail,
  ],
  sales: [
    ...common, ['shop_id', 'text'], ['sale_date', 'text'], ['paid_amount', 'money'],
    ['bill_amount', 'money'], ['cancelled_at', 'ts'], ...tail,
  ],
  payments: [
    ...common, ['shop_id', 'text'], ['amount', 'money'], ['pay_date', 'text'], ...tail,
  ],
  receipt_items: [
    ...common, ['receipt_id', 'text'], ['product_id', 'text'], ['memo_qty_pieces', 'int'],
    ['received_qty_pieces', 'int'], ['unit_buy_price', 'money'], ...tail,
  ],
  sale_items: [
    ...common, ['sale_id', 'text'], ['product_id', 'text'], ['qty_pieces', 'int'],
    ['unit_sell_price', 'money'], ['unit_buy_price', 'money'], ...tail,
  ],
}

export const TABLE_ORDER = Object.keys(TABLES)

const SQL_TYPE = { text: 'text', ts: 'text', int: 'integer', money: 'integer', bool: 'integer' }

const tableSql = (name) => `
create table ${name} (
  ${TABLES[name].map(([c, k]) => `${c} ${SQL_TYPE[k]}${c === 'id' ? ' primary key' : ''}`).join(',\n  ')},
  _dirty integer not null default 0,  -- changed on the phone, not yet sent
  _ver   integer not null default 0,  -- bumped on every local change
  _error text                         -- why the server rejected it, if it did
);
create index ${name}_dirty_idx on ${name} (_dirty) where _dirty = 1;`

// Same logic as the Postgres views / functions (supabase 08), in SQLite.
export const SCHEMA_V1 = `
${TABLE_ORDER.map(tableSql).join('\n')}

create index sales_shop_idx on sales (shop_id);
create index sales_date_idx on sales (sale_date);
create index sale_items_sale_idx on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);
create index payments_shop_idx on payments (shop_id);
create index payments_date_idx on payments (pay_date);
create index receipt_items_receipt_idx on receipt_items (receipt_id);
create index receipt_items_product_idx on receipt_items (product_id);
create unique index shops_name_area_uq
  on shops (lower(name), lower(coalesce(area, ''))) where deleted_at is null;

create table _meta (key text primary key, value text);

create view sales_summary as
select
  x.id, x.shop_id, x.sale_date, x.paid_amount, x.cost, x.total,
  case when x.total is not null then x.total - x.paid_amount
       else max(x.cost - x.paid_amount, 0) end as due,
  case when x.total is not null then x.total - x.cost
       else max(x.paid_amount - x.cost, 0) end as profit
from (
  select
    s.id, s.shop_id, s.sale_date, s.paid_amount,
    -- cost is rounded to 2 decimals like the server's numeric(12,2)
    cast(round(coalesce(sum(i.qty_pieces * i.unit_buy_price), 0) / 100.0) * 100 as integer) as cost,
    coalesce(
      s.bill_amount,
      case when count(i.id) = count(i.unit_sell_price)
           then coalesce(sum(i.qty_pieces * i.unit_sell_price), 0) end
    ) as total
  from sales s
  left join sale_items i on i.sale_id = s.id and i.deleted_at is null
  where s.cancelled_at is null and s.deleted_at is null
  group by s.id
) x;

create view shop_balances as
select
  sh.id as shop_id,
  coalesce((select sum(ss.due) from sales_summary ss where ss.shop_id = sh.id), 0)
  - coalesce((select sum(p.amount) from payments p
              where p.shop_id = sh.id and p.deleted_at is null and p.status = 1), 0) as balance
from shops sh
where sh.deleted_at is null;

create view product_stock as
select
  p.id as product_id,
  coalesce((select sum(ri.received_qty_pieces)
            from receipt_items ri
            join receipts r on r.id = ri.receipt_id and r.deleted_at is null
            where ri.product_id = p.id and ri.deleted_at is null), 0) as received_pieces,
  coalesce((select sum(si.qty_pieces)
            from sale_items si
            join sales s on s.id = si.sale_id and s.deleted_at is null and s.cancelled_at is null
            where si.product_id = p.id and si.deleted_at is null), 0) as sold_pieces
from products p
where p.deleted_at is null;

create view receipts_summary as
select
  r.id, r.receive_date, r.memo_no, r.memo_amount, r.driver_name, r.driver_paid, r.note,
  coalesce(sum(max(i.memo_qty_pieces - i.received_qty_pieces, 0)), 0) as short_pieces,
  cast(round(coalesce(sum(max(i.memo_qty_pieces - i.received_qty_pieces, 0) * i.unit_buy_price), 0)
             / 100.0) * 100 as integer) as short_value
from receipts r
left join receipt_items i on i.receipt_id = r.id and i.deleted_at is null
where r.deleted_at is null
group by r.id;

create view company_balance as
select
  coalesce((select sum(amount) from company_payments where deleted_at is null), 0) as paid,
  coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0) as charged,
  coalesce((select sum(amount) from company_payments where deleted_at is null), 0)
  - coalesce((select sum(memo_amount) from receipts where deleted_at is null), 0) as balance;
`

// Bump when the schema changes; db.js runs the steps after the stored version.
export const MIGRATIONS = [SCHEMA_V1]
