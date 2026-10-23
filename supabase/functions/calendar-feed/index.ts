// Takvim aboneliği: Apple Takvim / Google Takvim bu adresi düzenli aralıklarla okur.
// GET /functions/v1/calendar-feed?t=<gizli anahtar>  → text/calendar (iCalendar)
// JWT doğrulaması KAPALI olmalı (takvim uygulamaları oturum bilgisi göndermez); erişim yalnızca gizli anahtarla.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const OFFICE_ADDRESS = Deno.env.get("OFFICE_ADDRESS") || "";
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escTxt = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// RFC 5545: satırlar 75 baytta katlanır (UTF-8 karakterleri bölünmeden)
function fold(line: string) {
  const enc = new TextEncoder(); const out: string[] = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length, lim = out.length ? 74 : 75;
    if (bytes + b > lim) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const typeLabel = (t: string) => t === "online" ? "Online" : "Yüz yüze";

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  const sb = db();
  const { data: feed } = await sb.from("calendar_feed").select("token, show_names").eq("id", 1).maybeSingle();
  if (!feed || !t || !same(t, feed.token)) return new Response("Not found", { status: 404 });

  const from = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: rows, error } = await sb.from("bookings")
    .select("id, starts_at, type, name, phone, email, note, status, created_at, slots(ends_at)")
    .neq("status", "iptal").gte("starts_at", from).order("starts_at");
  if (error) return new Response("Error", { status: 500 });

  const now = stamp(new Date().toISOString());
  const L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//pskhevaldenizozdemir.com//Randevular//TR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Danışan seansları", "X-WR-TIMEZONE:Europe/Istanbul",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M",
  ];
  for (const b of rows || []) {
    const end = (b as any).slots?.ends_at || new Date(new Date(b.starts_at).getTime() + 50 * 60000).toISOString();
    const summary = feed.show_names ? `Seans: ${b.name} (${typeLabel(b.type)})` : `Seans (${typeLabel(b.type)})`;
    const desc = feed.show_names
      ? [`Danışan: ${b.name}`, `Telefon: ${b.phone}`, b.email ? `E-posta: ${b.email}` : "", b.note ? `Not: ${b.note}` : "", b.status === "tamamlandi" ? "Durum: Tamamlandı" : ""].filter(Boolean).join("\n")
      : "Ayrıntılar yönetim panelinde.";
    L.push("BEGIN:VEVENT", `UID:feed-${b.id}@pskhevaldenizozdemir.com`, `DTSTAMP:${now}`,
      `DTSTART:${stamp(b.starts_at)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${escTxt(summary)}`, `DESCRIPTION:${escTxt(desc)}`,
      `LOCATION:${escTxt(b.type === "online" ? "Online görüşme" : OFFICE_ADDRESS)}`,
      "STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return new Response(L.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'inline; filename="randevular.ics"' },
  });
});
