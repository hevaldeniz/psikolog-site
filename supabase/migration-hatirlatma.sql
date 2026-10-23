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
