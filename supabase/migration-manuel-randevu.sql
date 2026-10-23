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
