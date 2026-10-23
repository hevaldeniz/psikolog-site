-- =========================================================
-- Randevu sistemi veritabanı — Supabase > SQL Editor'a yapıştırıp "Run" deyin.
-- =========================================================

-- Yöneticiler (yalnızca bu tablodaki kullanıcılar paneli kullanabilir)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Yönetici yetkisi yalnızca iki adımlı doğrulamayla (aal2) açılmış oturumlarda geçerli
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Seans saatleri
create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null unique,
  ends_at timestamptz not null,
  type text not null check (type in ('online', 'yuzyuze', 'ikisi')),
  status text not null default 'available' check (status in ('available', 'booked')),
  created_at timestamptz not null default now()
);
create index if not exists slots_starts_idx on public.slots (starts_at);

-- Randevular (kişisel veri: yalnızca yönetici okuyabilir)
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete restrict,
  starts_at timestamptz not null,
  type text not null,
  name text not null check (char_length(name) between 2 and 120),
  phone text not null check (char_length(phone) between 7 and 30),
  email text check (email is null or char_length(email) <= 160),
  note text check (note is null or char_length(note) <= 600),
  status text not null default 'onayli' check (status in ('onayli', 'tamamlandi', 'iptal')),
  kvkk_consent_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bookings_starts_idx on public.bookings (starts_at);

-- Satır düzeyi güvenlik
alter table public.admins enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins for select using (user_id = auth.uid());

drop policy if exists "public sees open future slots" on public.slots;
create policy "public sees open future slots" on public.slots
  for select using (status = 'available' and starts_at > now());

drop policy if exists "admin manages slots" on public.slots;
create policy "admin manages slots" on public.slots
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manages bookings" on public.bookings;
create policy "admin manages bookings" on public.bookings
  for all using (public.is_admin()) with check (public.is_admin());

-- Danışanın randevu alması: tek adımda ve çakışmasız. "ikisi" saatlerde danışan türü seçer.
create or replace function public.book_slot(
  p_slot uuid, p_name text, p_phone text, p_email text default null, p_note text default null, p_type text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.slots; new_id uuid; chosen text;
begin
  if array_length(regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+'), 1) < 2 then raise exception 'name_required'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 10 then raise exception 'phone_required'; end if;
  if coalesce(btrim(p_email), '') !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'email_required'; end if;
  select * into s from public.slots where id = p_slot for update;
  if s.id is null or s.status <> 'available' or s.starts_at <= now() then
    raise exception 'slot_unavailable';
  end if;
  if s.type = 'ikisi' then
    if p_type is null or p_type not in ('online', 'yuzyuze') then raise exception 'type_required'; end if;
    chosen := p_type;
  else
    chosen := s.type;
  end if;
  insert into public.bookings (slot_id, starts_at, type, name, phone, email, note)
  values (s.id, s.starts_at, chosen, btrim(p_name), btrim(p_phone), btrim(p_email), nullif(btrim(p_note), ''))
  returning id into new_id;
  update public.slots set status = 'booked' where id = s.id;
  return new_id;
end; $$;

revoke all on function public.book_slot(uuid, text, text, text, text, text) from public;
grant execute on function public.book_slot(uuid, text, text, text, text, text) to anon, authenticated;

-- Yöneticinin randevu durumunu değiştirmesi (iptalde saat yeniden açılır)
create or replace function public.admin_set_booking_status(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.bookings set status = p_status where id = p_booking returning * into b;
  if b.id is null then raise exception 'not_found'; end if;
  update public.slots
     set status = case when p_status = 'iptal' and starts_at > now() then 'available' else 'booked' end
   where id = b.slot_id;
end; $$;

revoke all on function public.admin_set_booking_status(uuid, text) from public;
grant execute on function public.admin_set_booking_status(uuid, text) to authenticated;

-- Test / envanter gönderimleri (yalnızca sunucu fonksiyonu yazar, yalnızca yönetici okur)
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  form_id text not null,
  form_title text not null,
  name text not null,
  email text not null,
  phone text,
  answers jsonb not null,
  score int,
  severity text,
  flags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists assessments_created_idx on public.assessments (created_at desc);
create index if not exists assessments_email_idx on public.assessments (email, created_at);
alter table public.assessments enable row level security;

drop policy if exists "admin reads assessments" on public.assessments;
create policy "admin reads assessments" on public.assessments
  for select using (public.is_admin());
drop policy if exists "admin deletes assessments" on public.assessments;
create policy "admin deletes assessments" on public.assessments
  for delete using (public.is_admin());

-- ---------------------------------------------------------
-- SON ADIM: Authentication > Users'ta kendinize kullanıcı oluşturduktan sonra
-- aşağıdaki satırdaki e-postayı değiştirip ayrıca çalıştırın:
-- insert into public.admins (user_id) select id from auth.users where email = 'sizin@epostaniz.com';
-- ---------------------------------------------------------

-- Yetkileri daralt (RLS'e ek ikinci savunma hattı)
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;
revoke all on public.bookings from anon;
revoke all on public.assessments from anon;
revoke insert, update, delete, truncate on public.slots from anon;
revoke execute on function public.admin_set_booking_status(uuid, text) from anon;


-- ===== Randevu iptali (migration-iptal.sql, 23 Ekim 2026) =====
-- Danışanın e-postadaki bağlantıyla randevu iptali + tüm iptallerde e-posta bildirimi
alter table public.bookings add column if not exists cancel_token uuid not null default gen_random_uuid();
create unique index if not exists bookings_cancel_token_idx on public.bookings (cancel_token);
alter table public.bookings add column if not exists cancelled_at timestamptz;
alter table public.bookings add column if not exists cancelled_by text;
alter table public.bookings add column if not exists cancel_notified_at timestamptz;

-- İptal sayfası: bağlantıdaki anahtarla yalnızca gerekli bilgiyi döndürür
create or replace function public.booking_by_token(p_token uuid)
returns table (starts_at timestamptz, ends_at timestamptz, type text, status text, first_name text, can_cancel boolean)
language sql stable security definer set search_path = public as $$
  select b.starts_at, s.ends_at, b.type, b.status, split_part(b.name, ' ', 1),
         (b.status = 'onayli' and b.starts_at > now() + interval '24 hours')
  from public.bookings b join public.slots s on s.id = b.slot_id
  where b.cancel_token = p_token;
$$;
revoke all on function public.booking_by_token(uuid) from public;
grant execute on function public.booking_by_token(uuid) to anon, authenticated;

-- Danışanın iptali: seanstan en az 24 saat önce
create or replace function public.cancel_booking_by_token(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where cancel_token = p_token for update;
  if b.id is null then return 'not_found'; end if;
  if b.status = 'iptal' then return 'already'; end if;
  if b.status <> 'onayli' or b.starts_at <= now() + interval '24 hours' then return 'too_late'; end if;
  update public.bookings set status = 'iptal', cancelled_at = now(), cancelled_by = 'danisan' where id = b.id;
  update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  return 'ok';
end; $$;
revoke all on function public.cancel_booking_by_token(uuid) from public;
grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;

-- Panelden iptal: kimin iptal ettiğini kaydet
create or replace function public.admin_set_booking_status(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.bookings set
    cancelled_at = case when p_status = 'iptal' and status <> 'iptal' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'iptal' and status <> 'iptal' then 'psikolog' else cancelled_by end,
    status = p_status
  where id = p_booking returning * into b;
  if b.id is null then raise exception 'not_found'; end if;
  update public.slots
     set status = case when p_status = 'iptal' and starts_at > now() then 'available' else 'booked' end
   where id = b.slot_id;
end; $$;
revoke all on function public.admin_set_booking_status(uuid, text) from public;
grant execute on function public.admin_set_booking_status(uuid, text) to authenticated;

-- İptal olduğu anda e-posta fonksiyonunu tetikle
drop trigger if exists randevu_iptal_bildirimi on public.bookings;
create trigger randevu_iptal_bildirimi
  after update of status on public.bookings
  for each row when (old.status is distinct from new.status and new.status = 'iptal')
  execute function supabase_functions.http_request(
    'https://etqlcpukpiayywozxqmu.supabase.co/functions/v1/notify-booking',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cWxjcHVrcGlheXl3b3p4cW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Njk0OTUsImV4cCI6MjEwODI0NTQ5NX0.uSLZYgvJIGHhW65YPci2yuRMeAZZ2Hed2NsVo3aHPMc"}',
    '{}',
    '5000'
  );


-- ===== İptal 12 saat + geç iptal + hatırlatmalar (migration-hatirlatma.sql, 23 Ekim 2026) =====
-- 1) İptal butonu seanstan 12 saat öncesine kadar çalışır; 24 saatten az kala yapılan iptal "geç iptal" olarak işaretlenir.
-- 2) Danışana seanstan 3 gün ve 1 gün önce hatırlatma e-postası (saatlik zamanlanmış görev).
alter table public.bookings add column if not exists late_cancel boolean not null default false;
alter table public.bookings add column if not exists reminder3_sent_at timestamptz;
alter table public.bookings add column if not exists reminder1_sent_at timestamptz;

-- İptal sayfası: dönen alanlara "geç iptal penceresinde mi" bilgisi eklendi (dönüş tipi değiştiği için önce silinir)
drop function if exists public.booking_by_token(uuid);
create function public.booking_by_token(p_token uuid)
returns table (starts_at timestamptz, ends_at timestamptz, type text, status text, first_name text, can_cancel boolean, is_late boolean)
language sql stable security definer set search_path = public as $$
  select b.starts_at, s.ends_at, b.type, b.status, split_part(b.name, ' ', 1),
         (b.status = 'onayli' and b.starts_at > now() + interval '12 hours'),
         (b.starts_at <= now() + interval '24 hours')
  from public.bookings b join public.slots s on s.id = b.slot_id
  where b.cancel_token = p_token;
$$;
revoke all on function public.booking_by_token(uuid) from public;
grant execute on function public.booking_by_token(uuid) to anon, authenticated;

-- Danışanın iptali: seanstan en az 12 saat önce; 24 saatten az kaldıysa geç iptal
create or replace function public.cancel_booking_by_token(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where cancel_token = p_token for update;
  if b.id is null then return 'not_found'; end if;
  if b.status = 'iptal' then return 'already'; end if;
  if b.status <> 'onayli' or b.starts_at <= now() + interval '12 hours' then return 'too_late'; end if;
  update public.bookings
     set status = 'iptal', cancelled_at = now(), cancelled_by = 'danisan',
         late_cancel = (b.starts_at <= now() + interval '24 hours')
   where id = b.id;
  update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  return 'ok';
end; $$;
revoke all on function public.cancel_booking_by_token(uuid) from public;
grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;

-- Hatırlatma gönderilecek randevuları atomik olarak "gönderildi" işaretleyip döndürür (yalnızca e-posta fonksiyonu çağırabilir)
--  3gun: seansa 48–72 saat kalmış, randevu seanstan en az 3 gün önce alınmış
--  1gun: seansa 2–24 saat kalmış, randevu seanstan en az 1 gün önce alınmış
create or replace function public.claim_reminders(p_kind text)
returns setof public.bookings language plpgsql security definer set search_path = public as $$
begin
  if p_kind = '3gun' then
    return query with u as (
      update public.bookings set reminder3_sent_at = now()
       where status = 'onayli' and reminder3_sent_at is null and email is not null
         and starts_at > now() + interval '48 hours' and starts_at <= now() + interval '72 hours'
         and created_at < starts_at - interval '72 hours'
      returning *) select * from u;
  elsif p_kind = '1gun' then
    return query with u as (
      update public.bookings set reminder1_sent_at = now()
       where status = 'onayli' and reminder1_sent_at is null and email is not null
         and starts_at > now() + interval '2 hours' and starts_at <= now() + interval '24 hours'
         and created_at < starts_at - interval '24 hours'
      returning *) select * from u;
  end if;
end; $$;
revoke all on function public.claim_reminders(text) from public, anon, authenticated;
grant execute on function public.claim_reminders(text) to service_role;

-- Saatlik zamanlanmış görev: her saatin 7. dakikasında e-posta fonksiyonunu hatırlatma modunda çağırır
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'randevu-hatirlatma';
select cron.schedule('randevu-hatirlatma', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://etqlcpukpiayywozxqmu.supabase.co/functions/v1/notify-booking',
    body := '{"type":"REMINDERS"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cWxjcHVrcGlheXl3b3p4cW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Njk0OTUsImV4cCI6MjEwODI0NTQ5NX0.uSLZYgvJIGHhW65YPci2yuRMeAZZ2Hed2NsVo3aHPMc"}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);
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
-- Yönetim panelinden elle randevu ekleme (tek seans ya da haftalık tekrar)
alter table public.bookings add column if not exists source text not null default 'site';

create or replace function public.admin_create_booking(
  p_starts timestamptz, p_minutes int, p_type text, p_name text, p_phone text,
  p_email text default null, p_note text default null, p_notify boolean default true, p_weeks int default 1
) returns int language plpgsql security definer set search_path = public as $$
declare
  i int; st timestamptz; en timestamptz; s public.slots; sid uuid; n int := 0;
  mail text := nullif(btrim(coalesce(p_email, '')), '');
  lbl text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_type is null or p_type not in ('online', 'yuzyuze') then raise exception 'type_required'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 7 then raise exception 'phone_required'; end if;
  if mail is not null and mail !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'email_invalid'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then raise exception 'duration_invalid'; end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then raise exception 'weeks_invalid'; end if;

  for i in 0 .. p_weeks - 1 loop
    st := p_starts + make_interval(weeks => i);
    en := st + make_interval(mins => p_minutes);
    lbl := to_char(st at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
    s := null;
    select * into s from public.slots where starts_at = st for update;
    if s.id is not null and s.status <> 'available' then raise exception 'slot_taken:%', lbl; end if;
    -- Çakışan boş saatler: hiç randevuya bağlı değilse kaldır
    delete from public.slots o
     where o.id is distinct from s.id and o.status = 'available' and o.starts_at < en and o.ends_at > st
       and not exists (select 1 from public.bookings x where x.slot_id = o.id);
    if exists (select 1 from public.slots o where o.id is distinct from s.id and o.starts_at < en and o.ends_at > st) then
      raise exception 'overlap:%', lbl;
    end if;
    if s.id is not null then
      update public.slots set status = 'booked', ends_at = en where id = s.id;
      sid := s.id;
    else
      insert into public.slots (starts_at, ends_at, type, status) values (st, en, p_type, 'booked') returning id into sid;
    end if;
    insert into public.bookings (slot_id, starts_at, type, name, phone, email, note, source, status,
                                 notified_at, reminder3_sent_at, reminder1_sent_at)
    values (sid, st, p_type, btrim(p_name), btrim(p_phone), mail, nullif(btrim(coalesce(p_note, '')), ''), 'panel',
            case when en <= now() then 'tamamlandi' else 'onayli' end,
            -- Onay e-postası yalnızca ilk (gelecekteki) seans için; tekrarlar hatırlatma e-postalarıyla bildirilir
            case when p_notify and mail is not null and i = 0 and st > now() then null else now() end,
            case when p_notify and mail is not null then null else now() end,
            case when p_notify and mail is not null then null else now() end);
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.admin_create_booking(timestamptz, int, text, text, text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_create_booking(timestamptz, int, text, text, text, text, text, boolean, int) to authenticated;
-- Panelden eklenen randevularda psikoloğa her zaman bildirim; danışana yalnızca seçildiyse
alter table public.bookings add column if not exists notify_client boolean not null default true;

create or replace function public.admin_create_booking(
  p_starts timestamptz, p_minutes int, p_type text, p_name text, p_phone text,
  p_email text default null, p_note text default null, p_notify boolean default true, p_weeks int default 1
) returns int language plpgsql security definer set search_path = public as $$
declare
  i int; st timestamptz; en timestamptz; s public.slots; sid uuid; n int := 0;
  mail text := nullif(btrim(coalesce(p_email, '')), '');
  lbl text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_type is null or p_type not in ('online', 'yuzyuze') then raise exception 'type_required'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 7 then raise exception 'phone_required'; end if;
  if mail is not null and mail !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'email_invalid'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then raise exception 'duration_invalid'; end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then raise exception 'weeks_invalid'; end if;

  for i in 0 .. p_weeks - 1 loop
    st := p_starts + make_interval(weeks => i);
    en := st + make_interval(mins => p_minutes);
    lbl := to_char(st at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
    s := null;
    select * into s from public.slots where starts_at = st for update;
    if s.id is not null and s.status <> 'available' then raise exception 'slot_taken:%', lbl; end if;
    -- Çakışan boş saatler: hiç randevuya bağlı değilse kaldır
    delete from public.slots o
     where o.id is distinct from s.id and o.status = 'available' and o.starts_at < en and o.ends_at > st
       and not exists (select 1 from public.bookings x where x.slot_id = o.id);
    if exists (select 1 from public.slots o where o.id is distinct from s.id and o.starts_at < en and o.ends_at > st) then
      raise exception 'overlap:%', lbl;
    end if;
    if s.id is not null then
      update public.slots set status = 'booked', ends_at = en where id = s.id;
      sid := s.id;
    else
      insert into public.slots (starts_at, ends_at, type, status) values (st, en, p_type, 'booked') returning id into sid;
    end if;
    insert into public.bookings (slot_id, starts_at, type, name, phone, email, note, source, status, notify_client,
                                 notified_at, reminder3_sent_at, reminder1_sent_at)
    values (sid, st, p_type, btrim(p_name), btrim(p_phone), mail, nullif(btrim(coalesce(p_note, '')), ''), 'panel',
            case when en <= now() then 'tamamlandi' else 'onayli' end,
            (p_notify and mail is not null),
            -- Bildirim yalnızca ilk (gelecekteki) seans için: psikoloğa her zaman, danışana seçildiyse
            case when i = 0 and st > now() then null else now() end,
            case when p_notify and mail is not null then null else now() end,
            case when p_notify and mail is not null then null else now() end);
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.admin_create_booking(timestamptz, int, text, text, text, text, text, boolean, int) from public, anon;
grant execute on function public.admin_create_booking(timestamptz, int, text, text, text, text, text, boolean, int) to authenticated;
