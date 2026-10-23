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
