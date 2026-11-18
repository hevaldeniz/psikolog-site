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
-- SMS bildirimleri (Netgsm): 1 gün önce hatırlatma için tek gönderim alanı ve sıra alma fonksiyonu
alter table public.bookings add column if not exists sms_reminder_sent_at timestamptz;

create or replace function public.claim_sms_reminders()
returns setof public.bookings language plpgsql security definer set search_path = public as $$
begin
  return query with u as (
    update public.bookings set sms_reminder_sent_at = now()
     where status = 'onayli' and sms_reminder_sent_at is null and notify_client
       and starts_at > now() + interval '2 hours' and starts_at <= now() + interval '24 hours'
       and created_at < starts_at - interval '24 hours'
    returning *) select * from u;
end; $$;
revoke all on function public.claim_sms_reminders() from public, anon, authenticated;
grant execute on function public.claim_sms_reminders() to service_role;

-- Panel: "danışana bildirim" seçimi artık e-posta olmasa da geçerli (SMS için)
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
            p_notify,
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
-- Randevu gün/saat değişikliği: danışan (e-posta/SMS bağlantısıyla) ve psikolog (panelden)
alter table public.bookings add column if not exists rescheduled_at timestamptz;
alter table public.bookings add column if not exists rescheduled_by text;
alter table public.bookings add column if not exists previous_starts_at timestamptz;
alter table public.bookings add column if not exists reschedule_count int not null default 0;
alter table public.bookings add column if not exists reschedule_notified_at timestamptz;

-- Danışan: bağlantıdaki anahtarla, seanstan en az 12 saat önce, açık bir saate taşır
create or replace function public.reschedule_booking_by_token(p_token uuid, p_slot uuid, p_type text default null)
returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings; s public.slots; chosen text;
begin
  select * into b from public.bookings where cancel_token = p_token for update;
  if b.id is null then return 'not_found'; end if;
  if b.status <> 'onayli' or b.starts_at <= now() + interval '12 hours' then return 'too_late'; end if;
  select * into s from public.slots where id = p_slot for update;
  if s.id is null or s.status <> 'available' or s.starts_at <= now() then return 'slot_unavailable'; end if;
  if s.type = 'ikisi' then
    chosen := case when p_type in ('online', 'yuzyuze') then p_type else b.type end;
  else chosen := s.type; end if;
  update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  update public.slots set status = 'booked' where id = s.id;
  update public.bookings set
    slot_id = s.id, starts_at = s.starts_at, type = chosen,
    previous_starts_at = b.starts_at, rescheduled_at = now(), rescheduled_by = 'danisan',
    reschedule_count = b.reschedule_count + 1, reschedule_notified_at = null,
    reminder3_sent_at = case when b.notify_client then null else now() end,
    reminder1_sent_at = case when b.notify_client then null else now() end,
    sms_reminder_sent_at = case when b.notify_client then null else now() end
  where id = b.id;
  return 'ok';
end; $$;
revoke all on function public.reschedule_booking_by_token(uuid, uuid, text) from public;
grant execute on function public.reschedule_booking_by_token(uuid, uuid, text) to anon, authenticated;

-- Psikolog (panel): istenen tarih/saate taşır; o saatte boş saat varsa kullanır, yoksa oluşturur
create or replace function public.admin_reschedule_booking(
  p_booking uuid, p_starts timestamptz, p_minutes int, p_type text, p_notify boolean default true
) returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings; s public.slots; sid uuid; en timestamptz; lbl text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_type is null or p_type not in ('online', 'yuzyuze') then raise exception 'type_required'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then raise exception 'duration_invalid'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.status <> 'onayli' then raise exception 'not_active'; end if;
  en := p_starts + make_interval(mins => p_minutes);
  lbl := to_char(p_starts at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
  select * into s from public.slots where starts_at = p_starts and id <> b.slot_id for update;
  if s.id is not null and s.status <> 'available' then raise exception 'slot_taken:%', lbl; end if;
  delete from public.slots o
   where o.id <> b.slot_id and o.id is distinct from s.id and o.status = 'available' and o.starts_at < en and o.ends_at > p_starts
     and not exists (select 1 from public.bookings x where x.slot_id = o.id);
  if exists (select 1 from public.slots o where o.id <> b.slot_id and o.id is distinct from s.id and o.starts_at < en and o.ends_at > p_starts) then
    raise exception 'overlap:%', lbl;
  end if;
  if s.id is not null then
    -- Yeni saatte açık bir saat var: onu kullan, eski saati yeniden aç
    update public.slots set status = 'booked', ends_at = en where id = s.id; sid := s.id;
    update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  elsif p_starts = b.starts_at then
    -- Saat aynı; yalnızca süre/tür değişiyor
    update public.slots set ends_at = en where id = b.slot_id; sid := b.slot_id;
  else
    -- Yeni saat oluştur, eski saati başka danışanlar için yeniden aç
    insert into public.slots (starts_at, ends_at, type, status) values (p_starts, en, p_type, 'booked') returning id into sid;
    update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  end if;
  update public.bookings set
    slot_id = sid, starts_at = p_starts, type = p_type,
    previous_starts_at = b.starts_at, rescheduled_at = now(), rescheduled_by = 'psikolog',
    reschedule_count = b.reschedule_count + 1,
    reschedule_notified_at = case when p_notify then null else now() end,
    reminder3_sent_at = case when b.notify_client then null else now() end,
    reminder1_sent_at = case when b.notify_client then null else now() end,
    sms_reminder_sent_at = case when b.notify_client then null else now() end
  where id = b.id;
  -- Eski saat yeni seansla çakışıyorsa (ör. 10:00 → 10:30) ve başka kayda bağlı değilse kaldır
  delete from public.slots o
   where o.id = b.slot_id and o.id <> sid and o.status = 'available' and o.starts_at < en and o.ends_at > p_starts
     and not exists (select 1 from public.bookings x where x.slot_id = o.id);
  return 'ok';
end; $$;
revoke all on function public.admin_reschedule_booking(uuid, timestamptz, int, text, boolean) from public, anon;
grant execute on function public.admin_reschedule_booking(uuid, timestamptz, int, text, boolean) to authenticated;

-- İptal sayfası: değişiklik/iptal yapılabilir mi bilgisi + son değişiklik
drop function if exists public.booking_by_token(uuid);
create function public.booking_by_token(p_token uuid)
returns table (starts_at timestamptz, ends_at timestamptz, type text, status text, first_name text, can_cancel boolean, is_late boolean, previous_starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.starts_at, s.ends_at, b.type, b.status, split_part(b.name, ' ', 1),
         (b.status = 'onayli' and b.starts_at > now() + interval '12 hours'),
         (b.starts_at <= now() + interval '24 hours'), b.previous_starts_at
  from public.bookings b join public.slots s on s.id = b.slot_id
  where b.cancel_token = p_token;
$$;
revoke all on function public.booking_by_token(uuid) from public;
grant execute on function public.booking_by_token(uuid) to anon, authenticated;

-- Hatırlatmalar: taşınan randevularda "en az 1/3 gün önce" koşulu değişiklik anından itibaren
create or replace function public.claim_reminders(p_kind text)
returns setof public.bookings language plpgsql security definer set search_path = public as $$
begin
  if p_kind = '3gun' then
    return query with u as (
      update public.bookings set reminder3_sent_at = now()
       where status = 'onayli' and reminder3_sent_at is null and email is not null
         and starts_at > now() + interval '48 hours' and starts_at <= now() + interval '72 hours'
         and coalesce(rescheduled_at, created_at) < starts_at - interval '72 hours'
      returning *) select * from u;
  elsif p_kind = '1gun' then
    return query with u as (
      update public.bookings set reminder1_sent_at = now()
       where status = 'onayli' and reminder1_sent_at is null and email is not null
         and starts_at > now() + interval '2 hours' and starts_at <= now() + interval '24 hours'
         and coalesce(rescheduled_at, created_at) < starts_at - interval '24 hours'
      returning *) select * from u;
  end if;
end; $$;
revoke all on function public.claim_reminders(text) from public, anon, authenticated;
grant execute on function public.claim_reminders(text) to service_role;

create or replace function public.claim_sms_reminders()
returns setof public.bookings language plpgsql security definer set search_path = public as $$
begin
  return query with u as (
    update public.bookings set sms_reminder_sent_at = now()
     where status = 'onayli' and sms_reminder_sent_at is null and notify_client
       and starts_at > now() + interval '2 hours' and starts_at <= now() + interval '24 hours'
       and coalesce(rescheduled_at, created_at) < starts_at - interval '24 hours'
    returning *) select * from u;
end; $$;
revoke all on function public.claim_sms_reminders() from public, anon, authenticated;
grant execute on function public.claim_sms_reminders() to service_role;

-- Gün/saat değiştiğinde e-posta/SMS fonksiyonunu tetikle
drop trigger if exists randevu_degisiklik_bildirimi on public.bookings;
create trigger randevu_degisiklik_bildirimi
  after update of starts_at on public.bookings
  for each row when (old.starts_at is distinct from new.starts_at and new.status = 'onayli')
  execute function supabase_functions.http_request(
    'https://etqlcpukpiayywozxqmu.supabase.co/functions/v1/notify-booking',
    'POST',
    '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cWxjcHVrcGlheXl3b3p4cW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Njk0OTUsImV4cCI6MjEwODI0NTQ5NX0.uSLZYgvJIGHhW65YPci2yuRMeAZZ2Hed2NsVo3aHPMc"}',
    '{}',
    '5000'
  );
-- Panel "Randevuyu düzenle": gün/saat/süre/tür; değişiklik bildirimi ve hatırlatmalar ayrı ayrı seçilebilir
drop function if exists public.admin_reschedule_booking(uuid, timestamptz, int, text, boolean);
create or replace function public.admin_reschedule_booking(
  p_booking uuid, p_starts timestamptz, p_minutes int, p_type text, p_notify boolean default true, p_reminders boolean default true
) returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings; s public.slots; sid uuid; en timestamptz; lbl text; moved boolean;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_type is null or p_type not in ('online', 'yuzyuze') then raise exception 'type_required'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 240 then raise exception 'duration_invalid'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.status <> 'onayli' then raise exception 'not_active'; end if;
  en := p_starts + make_interval(mins => p_minutes);
  moved := p_starts <> b.starts_at;
  lbl := to_char(p_starts at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
  select * into s from public.slots where starts_at = p_starts and id <> b.slot_id for update;
  if s.id is not null and s.status <> 'available' then raise exception 'slot_taken:%', lbl; end if;
  delete from public.slots o
   where o.id <> b.slot_id and o.id is distinct from s.id and o.status = 'available' and o.starts_at < en and o.ends_at > p_starts
     and not exists (select 1 from public.bookings x where x.slot_id = o.id);
  if exists (select 1 from public.slots o where o.id <> b.slot_id and o.id is distinct from s.id and o.starts_at < en and o.ends_at > p_starts) then
    raise exception 'overlap:%', lbl;
  end if;
  if s.id is not null then
    -- Yeni saatte açık bir saat var: onu kullan, eski saati yeniden aç
    update public.slots set status = 'booked', ends_at = en where id = s.id; sid := s.id;
    update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  elsif p_starts = b.starts_at then
    -- Saat aynı; yalnızca süre/tür değişiyor
    update public.slots set ends_at = en where id = b.slot_id; sid := b.slot_id;
  else
    -- Yeni saat oluştur, eski saati başka danışanlar için yeniden aç
    insert into public.slots (starts_at, ends_at, type, status) values (p_starts, en, p_type, 'booked') returning id into sid;
    update public.slots set status = 'available' where id = b.slot_id and starts_at > now();
  end if;
  update public.bookings set
    slot_id = sid, starts_at = p_starts, type = p_type,
    previous_starts_at = case when moved then b.starts_at else b.previous_starts_at end,
    rescheduled_at = case when moved then now() else b.rescheduled_at end,
    rescheduled_by = case when moved then 'psikolog' else b.rescheduled_by end,
    reschedule_count = b.reschedule_count + case when moved then 1 else 0 end,
    reschedule_notified_at = case when moved then (case when p_notify then null else now() end) else b.reschedule_notified_at end,
    -- Bildirim ya da hatırlatma seçildiyse danışan bildirim alan olarak işaretlenir
    notify_client = b.notify_client or p_notify or p_reminders,
    -- Hatırlatmalar: seçilmediyse bu randevu için gönderilmez; saat değiştiyse yeni saate göre yeniden planlanır
    reminder3_sent_at = case when not p_reminders then coalesce(b.reminder3_sent_at, now()) when moved then null else b.reminder3_sent_at end,
    reminder1_sent_at = case when not p_reminders then coalesce(b.reminder1_sent_at, now()) when moved then null else b.reminder1_sent_at end,
    sms_reminder_sent_at = case when not p_reminders then coalesce(b.sms_reminder_sent_at, now()) when moved then null else b.sms_reminder_sent_at end
  where id = b.id;
  -- Eski saat yeni seansla çakışıyorsa (ör. 10:00 → 10:30) ve başka kayda bağlı değilse kaldır
  delete from public.slots o
   where o.id = b.slot_id and o.id <> sid and o.status = 'available' and o.starts_at < en and o.ends_at > p_starts
     and not exists (select 1 from public.bookings x where x.slot_id = o.id);
  return 'ok';
end; $$;
grant execute on function public.admin_reschedule_booking(uuid, timestamptz, int, text, boolean, boolean) to authenticated;
revoke all on function public.admin_reschedule_booking(uuid, timestamptz, int, text, boolean, boolean) from public, anon;
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
