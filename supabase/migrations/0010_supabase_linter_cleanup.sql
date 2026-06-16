-- Supabase database-linter cleanup.
-- Keeps service-role-only tables unreachable from anon/authenticated while satisfying
-- the "RLS enabled no policy" lint, optimizes auth.uid() usage in seller policies,
-- and pins the trigger helper search_path.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists sellers_owner_select on public.sellers;
drop policy if exists sellers_owner_insert on public.sellers;
drop policy if exists sellers_owner_update on public.sellers;

create policy sellers_owner_select on public.sellers
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy sellers_owner_insert on public.sellers
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy sellers_owner_update on public.sellers
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists stripe_events_service_role_all on public.stripe_events;
create policy stripe_events_service_role_all on public.stripe_events
  for all to service_role
  using (true)
  with check (true);

drop policy if exists connected_accounts_service_role_all on public.connected_accounts;
create policy connected_accounts_service_role_all on public.connected_accounts
  for all to service_role
  using (true)
  with check (true);

drop policy if exists audit_log_service_role_all on public.audit_log;
create policy audit_log_service_role_all on public.audit_log
  for all to service_role
  using (true)
  with check (true);
