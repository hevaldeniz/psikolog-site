-- Panel güvenliği: yönetici yetkisi yalnızca iki adımlı doğrulamayla (aal2) açılmış oturumlarda geçerli.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Yetkileri daralt (RLS'e ek ikinci savunma hattı)
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;
revoke all on public.bookings from anon;
revoke all on public.assessments from anon;
revoke insert, update, delete, truncate on public.slots from anon;
revoke execute on function public.admin_set_booking_status(uuid, text) from anon;
