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
