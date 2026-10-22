-- Randevu e-posta bildirimi: her randevu için tek gönderim
alter table public.bookings add column if not exists notified_at timestamptz;
