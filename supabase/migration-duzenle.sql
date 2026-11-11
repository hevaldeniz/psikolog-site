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
