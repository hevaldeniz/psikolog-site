-- Takvim aboneliği (Apple / Google Takvim): gizli bağlantı anahtarı ve ayarlar
-- Anahtar veritabanında rastgele üretilir; yalnızca yönetici (aal2) görebilir/yenileyebilir.
create table if not exists public.calendar_feed (
  id int primary key default 1 check (id = 1),
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  show_names boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.calendar_feed enable row level security;
drop policy if exists "calendar_feed admin" on public.calendar_feed;
create policy "calendar_feed admin" on public.calendar_feed
  for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.calendar_feed from anon;
grant select, update on public.calendar_feed to authenticated;
insert into public.calendar_feed default values on conflict (id) do nothing;

-- Bağlantıyı yenile: eski abonelik bağlantısı anında geçersiz olur
create or replace function public.admin_rotate_calendar_token() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.calendar_feed
     set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), created_at = now()
   where id = 1 returning token into t;
  return t;
end $$;
revoke execute on function public.admin_rotate_calendar_token() from public, anon;
grant execute on function public.admin_rotate_calendar_token() to authenticated;
