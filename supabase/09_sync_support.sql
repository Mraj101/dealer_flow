-- Dealer App: step 9 (sync support)
-- The phone now writes rows straight into the tables (no create_sale / create_receipt call),
-- so the rules those functions enforced must also hold in the tables themselves.
-- Run ONCE, after 08. Safe on existing data: the check is NOT VALID, so it only applies
-- to rows written from now on.

-- money collected can never be more than the bill
alter table sales
  add constraint sales_paid_le_bill
  check (bill_amount is null or paid_amount <= bill_amount) not valid;

-- sync reads changes in (updated_at, id) order
create index if not exists products_sync_idx         on products (updated_at, id);
create index if not exists shops_sync_idx            on shops (updated_at, id);
create index if not exists sales_sync_idx            on sales (updated_at, id);
create index if not exists sale_items_sync_idx       on sale_items (updated_at, id);
create index if not exists payments_sync_idx         on payments (updated_at, id);
create index if not exists company_payments_sync_idx on company_payments (updated_at, id);
create index if not exists receipts_sync_idx         on receipts (updated_at, id);
create index if not exists receipt_items_sync_idx    on receipt_items (updated_at, id);
