-- Online + Yüz yüze ortak saat ("ikisi"): danışan türü seçer, saat dolunca iki tür birden kapanır.
alter table public.slots drop constraint if exists slots_type_check;
alter table public.slots add constraint slots_type_check check (type in ('online', 'yuzyuze', 'ikisi'));

drop function if exists public.book_slot(uuid, text, text, text, text);
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
