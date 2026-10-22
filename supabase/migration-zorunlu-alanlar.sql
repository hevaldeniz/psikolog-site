-- Randevu formunda ad soyad, telefon ve e-posta zorunlu (sunucu tarafı kontrol)
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
