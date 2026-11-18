-- =========================================================
-- İstatistik paneli (istatistik.html)
--  * Çerezsiz, kimliksiz site sayacı (site_events)
--  * Panel üyeliği (stats_users): yönetici + sosyal medya danışmanı, aynı yetkiler.
--    Üyeler danışan verisini (isim, telefon, test cevapları) GÖREMEZ; yalnızca isimsiz toplamlar.
--  * Instagram: token yalnızca yazılabilir (ig_config hiçbir istemciye okunmaz),
--    veriler ig_daily / ig_media tablolarında.
-- =========================================================

-- ---------- Üyelik ----------
create table if not exists public.stats_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  added_at timestamptz not null default now(),
  added_by uuid
);
alter table public.stats_users enable row level security;
-- (politika yok: yalnızca aşağıdaki fonksiyonlar erişir)

insert into public.stats_users (user_id, email)
select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id
on conflict (user_id) do nothing;

-- Panel yetkisi: üye olmak + iki adımlı doğrulamayla (aal2) açılmış oturum
create or replace function public.is_stats_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stats_users where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
grant execute on function public.is_stats_user() to authenticated;

-- Üye mi? (iki adımlı doğrulamadan önce, giriş akışında kullanılır)
create or replace function public.stats_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.stats_users where user_id = auth.uid());
$$;
revoke all on function public.stats_is_member() from public, anon;
grant execute on function public.stats_is_member() to authenticated;

create or replace function public.stats_members() returns table (user_id uuid, email text, added_at timestamptz, is_owner boolean, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  return query
    select s.user_id, coalesce(u.email::text, s.email), s.added_at,
           exists (select 1 from public.admins a where a.user_id = s.user_id),
           s.user_id = auth.uid()
    from public.stats_users s left join auth.users u on u.id = s.user_id
    order by s.added_at;
end; $$;
revoke all on function public.stats_members() from public, anon;
grant execute on function public.stats_members() to authenticated;

-- Üye çıkarma: site sahibi (yönetici) çıkarılamaz
create or replace function public.stats_remove_member(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  if exists (select 1 from public.admins where user_id = p_user) then return 'owner'; end if;
  delete from public.stats_users where user_id = p_user;
  return 'ok';
end; $$;
revoke all on function public.stats_remove_member(uuid) from public, anon;
grant execute on function public.stats_remove_member(uuid) to authenticated;

-- ---------- Site sayacı ----------
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,          -- view | whatsapp | telefon | eposta | instagram | harita | randevu_tamam | test_tamam
  path text,
  ref text,                    -- yönlendiren site (yalnızca alan adı)
  src text, med text, camp text,
  device text,                 -- mobil | masaustu | tablet
  sid text                     -- sekme oturumu (sessionStorage, çerez değil)
);
create index if not exists site_events_ts_idx on public.site_events (ts);
create index if not exists site_events_sid_idx on public.site_events (sid, ts);
alter table public.site_events enable row level security;

create or replace function public.track(p_kind text, p_path text, p_ref text, p_src text, p_med text, p_camp text, p_device text, p_sid text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := left(coalesce(p_kind, ''), 20); s text := left(coalesce(p_sid, ''), 40);
begin
  if k not in ('view','whatsapp','telefon','eposta','instagram','harita','randevu_tamam','test_tamam') then return; end if;
  if s !~ '^[A-Za-z0-9_-]{8,40}$' then return; end if;
  -- kötüye kullanım sınırı: bir oturumdan saatte en çok 200 kayıt
  if (select count(*) from public.site_events where sid = s and ts > now() - interval '1 hour') >= 200 then return; end if;
  insert into public.site_events (kind, path, ref, src, med, camp, device, sid)
  values (k, left(p_path, 200), nullif(lower(left(p_ref, 120)), ''), nullif(lower(left(p_src, 60)), ''),
          nullif(lower(left(p_med, 60)), ''), nullif(left(p_camp, 100), ''),
          case when p_device in ('mobil','masaustu','tablet') then p_device else null end, s);
end; $$;
revoke all on function public.track(text,text,text,text,text,text,text,text) from public;
grant execute on function public.track(text,text,text,text,text,text,text,text) to anon, authenticated;

-- Kaynağı okunur bir ada çevirir
create or replace function public.stats_source(p_src text, p_med text, p_ref text) returns text
language sql immutable as $$
  select case
    when p_src is not null and p_med in ('cpc','ppc','paid','ads') and p_src like '%google%' then 'Google Ads'
    when p_src = 'google_ads' then 'Google Ads'
    when p_src is not null and p_src like '%instagram%' or p_src = 'ig' then 'Instagram'
    when p_src is not null and (p_src like '%facebook%' or p_src = 'fb') then 'Facebook'
    when p_src is not null then initcap(p_src)
    when p_ref is null then 'Doğrudan'
    when p_ref ~ '(^|\.)google\.' then 'Google'
    when p_ref ~ 'instagram\.com$' then 'Instagram'
    when p_ref ~ '(facebook\.com|fb\.com)$' then 'Facebook'
    when p_ref ~ '(bing\.com)$' then 'Bing'
    when p_ref ~ 'yandex\.' then 'Yandex'
    when p_ref ~ 'doktortakvimi' then 'Doktortakvimi'
    when p_ref ~ '(chatgpt\.com|openai\.com)$' then 'ChatGPT'
    when p_ref ~ '(t\.co|twitter\.com|x\.com)$' then 'X (Twitter)'
    when p_ref ~ 'linkedin' then 'LinkedIn'
    when p_ref ~ 'whatsapp' then 'WhatsApp'
    else regexp_replace(p_ref, '^www\.', '')
  end;
$$;

-- ---------- Genel bakış (isimsiz toplamlar) ----------
create or replace function public.stats_overview(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'Europe/Istanbul';
  t0 timestamptz := (p_from::timestamp at time zone tz);
  t1 timestamptz := ((p_to + 1)::timestamp at time zone tz);
  span interval := t1 - t0;
  r jsonb;
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'bad_range'; end if;

  with ev as (select * from public.site_events where ts >= t0 - span and ts < t1),
  cur as (select * from ev where ts >= t0),
  prev as (select * from ev where ts < t0),
  land as (  -- her oturumun ilk görüntülemesi = giriş sayfası ve kaynak
    select distinct on (sid) sid, ts, path, device, public.stats_source(src, med, ref) as source
    from cur where kind = 'view' order by sid, ts
  ),
  days as (select generate_series(p_from, p_to, interval '1 day')::date as d),
  bk as (select * from public.bookings where created_at >= t0 - span and created_at < t1),
  asm as (select * from public.assessments where created_at >= t0 - span and created_at < t1)
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'views', (select count(*) from cur where kind = 'view'),
      'sessions', (select count(distinct sid) from cur where kind = 'view'),
      'contacts', (select count(*) from cur where kind in ('whatsapp','telefon','eposta')),
      'web_bookings', (select count(*) from bk where created_at >= t0 and source <> 'panel'),
      'tests', (select count(*) from asm where created_at >= t0)
    ),
    'prev', jsonb_build_object(
      'views', (select count(*) from prev where kind = 'view'),
      'sessions', (select count(distinct sid) from prev where kind = 'view'),
      'contacts', (select count(*) from prev where kind in ('whatsapp','telefon','eposta')),
      'web_bookings', (select count(*) from bk where created_at < t0 and source <> 'panel'),
      'tests', (select count(*) from asm where created_at < t0)
    ),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
        'd', d,
        'views', (select count(*) from cur where kind = 'view' and (ts at time zone tz)::date = d),
        'sessions', (select count(distinct sid) from cur where kind = 'view' and (ts at time zone tz)::date = d),
        'bookings', (select count(*) from bk where created_at >= t0 and source <> 'panel' and (created_at at time zone tz)::date = d)
      ) order by d), '[]') from days),
    'pages', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', p, 'n', count(*)) x
        from (select coalesce(nullif(path, ''), '/') p from cur where kind = 'view') c group by p order by count(*) desc limit 12) q),
    'landing', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', p, 'n', count(*)) x
        from (select coalesce(nullif(path, ''), '/') p from land) c group by p order by count(*) desc limit 8) q),
    'sources', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', source, 'n', count(*)) x
        from land group by source order by count(*) desc limit 10) q),
    'campaigns', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', camp, 'n', count(distinct sid)) x
        from cur where kind = 'view' and camp is not null group by camp order by count(distinct sid) desc limit 8) q),
    'devices', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', coalesce(device, 'bilinmiyor'), 'n', count(*)) x
        from land group by device) q),
    'events', (select coalesce(jsonb_object_agg(kind, n), '{}') from (
        select kind, count(*) n from cur where kind <> 'view' group by kind) q),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h), '[]') from (
        select gs.h, (select count(*) from land where extract(hour from ts at time zone tz) = gs.h) n
        from generate_series(0, 23) gs(h)) q),
    'bookings', jsonb_build_object(
      'web', (select count(*) from bk where created_at >= t0 and source <> 'panel'),
      'panel', (select count(*) from bk where created_at >= t0 and source = 'panel'),
      'online', (select count(*) from bk where created_at >= t0 and source <> 'panel' and type = 'online'),
      'yuzyuze', (select count(*) from bk where created_at >= t0 and source <> 'panel' and type <> 'online'),
      'cancelled', (select count(*) from bk where created_at >= t0 and status = 'iptal')
    ),
    'tests', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('k', form_title, 'n', count(*)) x
        from asm where created_at >= t0 group by form_title) q)
  ) into r;
  return r;
end; $$;
revoke all on function public.stats_overview(date, date) from public, anon;
grant execute on function public.stats_overview(date, date) to authenticated;

-- ---------- Instagram ----------
create table if not exists public.ig_config (
  id int primary key default 1 check (id = 1),
  token text,
  ig_user_id text,
  host text,                       -- graph.instagram.com | graph.facebook.com
  username text,
  token_set_at timestamptz,
  token_set_by uuid,
  token_refreshed_at timestamptz,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_ok_at timestamptz,
  last_error text
);
alter table public.ig_config enable row level security;
-- (politika yok: token hiçbir istemciye okunmaz; yalnızca sunucu fonksiyonu kullanır)

create table if not exists public.ig_daily (
  day date primary key,
  followers int, follows int, media_count int,
  reach int, views int, accounts_engaged int, interactions int,
  likes int, comments int, shares int, saves int,
  profile_views int, website_clicks int, profile_links_taps int, new_followers int,
  updated_at timestamptz not null default now()
);
alter table public.ig_daily enable row level security;
drop policy if exists "ig_daily_read" on public.ig_daily;
create policy "ig_daily_read" on public.ig_daily for select using (public.is_stats_user());

create table if not exists public.ig_media (
  id text primary key,
  ts timestamptz,
  media_type text, product_type text,
  caption text, permalink text, thumb text,
  likes int, comments int, reach int, views int, saves int, shares int, interactions int,
  updated_at timestamptz not null default now()
);
create index if not exists ig_media_ts_idx on public.ig_media (ts desc);
alter table public.ig_media enable row level security;
drop policy if exists "ig_media_read" on public.ig_media;
create policy "ig_media_read" on public.ig_media for select using (public.is_stats_user());

-- Token kaydet (yalnızca yazma). Token bir daha hiçbir ekranda gösterilmez.
create or replace function public.ig_set_token(p_token text, p_user_id text) returns void
language plpgsql security definer set search_path = public as $$
declare t text := btrim(coalesce(p_token, ''));
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  if length(t) < 20 or t ~ '\s' then raise exception 'bad_token'; end if;
  insert into public.ig_config (id) values (1) on conflict (id) do nothing;
  update public.ig_config set
    token = t,
    ig_user_id = nullif(btrim(coalesce(p_user_id, '')), ''),
    host = case when t like 'EAA%' then 'graph.facebook.com' else 'graph.instagram.com' end,
    token_set_at = now(), token_set_by = auth.uid(),
    token_refreshed_at = now(), token_expires_at = null,
    last_sync_at = null, last_error = null
  where id = 1;
end; $$;
revoke all on function public.ig_set_token(text, text) from public, anon;
grant execute on function public.ig_set_token(text, text) to authenticated;

create or replace function public.ig_clear_token() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  update public.ig_config set token = null, last_error = null where id = 1;
end; $$;
revoke all on function public.ig_clear_token() from public, anon;
grant execute on function public.ig_clear_token() to authenticated;

create or replace function public.ig_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.ig_config;
begin
  if not public.is_stats_user() then raise exception 'not_allowed'; end if;
  select * into c from public.ig_config where id = 1;
  return jsonb_build_object(
    'connected', c.token is not null,
    'username', c.username,
    'api', case c.host when 'graph.facebook.com' then 'Facebook ile giriş' when 'graph.instagram.com' then 'Instagram ile giriş' end,
    'token_set_at', c.token_set_at,
    'token_set_by', (select email::text from auth.users where id = c.token_set_by),
    'token_expires_at', c.token_expires_at,
    'last_sync_at', c.last_sync_at,
    'last_ok_at', c.last_ok_at,
    'last_error', c.last_error
  );
end; $$;
revoke all on function public.ig_status() from public, anon;
grant execute on function public.ig_status() to authenticated;

-- Günlük Instagram senkronu (her gün 06:17, İstanbul saati)
select cron.unschedule(jobid) from cron.job where jobname = 'instagram-senkron';
select cron.schedule('instagram-senkron', '17 3 * * *', $cron$
  select net.http_post(
    url := 'https://etqlcpukpiayywozxqmu.supabase.co/functions/v1/istatistik',
    body := '{"action":"sync"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cWxjcHVrcGlheXl3b3p4cW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Njk0OTUsImV4cCI6MjEwODI0NTQ5NX0.uSLZYgvJIGHhW65YPci2yuRMeAZZ2Hed2NsVo3aHPMc"}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
