-- Code-review follow-up to 0002. Store deletion is audit-sensitive, so sellers
-- may manage store rows but not directly delete them through their user-scoped client.

revoke delete on public.stores from authenticated;

drop policy if exists stores_owner_all on public.stores;

create policy stores_owner_select on public.stores
  for select to authenticated
  using (is_store_owner(id));

create policy stores_owner_insert on public.stores
  for insert to authenticated
  with check (seller_id = current_seller_id());

create policy stores_owner_update on public.stores
  for update to authenticated
  using (is_store_owner(id))
  with check (seller_id = current_seller_id());
