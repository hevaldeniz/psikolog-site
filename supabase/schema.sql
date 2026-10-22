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
  values (s.id, s.starts_at, chosen, trim(p_name), trim(p_phone), nullif(trim(p_email), ''), nullif(trim(p_note), ''))
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
