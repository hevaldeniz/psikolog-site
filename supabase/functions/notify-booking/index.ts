// Supabase Edge Function: randevu e-postaları.
//  - Yeni randevu (INSERT): danışana onay (iptal butonlu), psikoloğa bildirim. Tek gönderim: notified_at.
//  - İptal (UPDATE → status 'iptal'): danışana ve psikoloğa iptal bildirimi. Tek gönderim: cancel_notified_at.
// Tetikleyiciler: randevu_bildirimi (INSERT), randevu_iptal_bildirimi (UPDATE). Gelen veriye güvenilmez;
// kayıt her seferinde veritabanından yeniden okunur.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SITE_URL = Deno.env.get("SITE_URL")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL")!;
const PSYCHOLOGIST_EMAIL = Deno.env.get("PSYCHOLOGIST_EMAIL")!;
const OFFICE_ADDRESS = Deno.env.get("OFFICE_ADDRESS") || "";
const CONTACT_PHONE = Deno.env.get("CONTACT_PHONE") || "";
const TZ = "Europe/Istanbul";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmtDate = (iso: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const typeLabel = (t: string) => t === "online" ? "Online (görüntülü)" : "Yüz yüze (ofiste)";

function ics(b: any, endIso: string, summary: string, description: string, cancel = false) {
  const d = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fold = (s: string) => s.replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//pskhevaldenizozdemir//randevu//TR", cancel ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${b.id}@pskhevaldenizozdemir.com`, `DTSTAMP:${d(new Date().toISOString())}`,
    ...(cancel ? ["STATUS:CANCELLED", "SEQUENCE:1"] : []),
    `DTSTART:${d(b.starts_at)}`, `DTEND:${d(endIso)}`, `SUMMARY:${fold(summary)}`, `DESCRIPTION:${fold(description)}`,
    ...(b.type === "yuzyuze" && OFFICE_ADDRESS ? [`LOCATION:${fold(OFFICE_ADDRESS)}`] : []),
    ...(cancel ? [] : ["BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Seans hatırlatması", "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function wrap(inner: string) {
  return `<div style="font-family:Arial,sans-serif;color:#141a2e;max-width:600px;margin:auto;line-height:1.6">${inner}
  <p style="font-size:12px;color:#56607a;margin-top:28px">Bu e-posta ${esc(SITE_URL)} üzerinden alınan randevu için otomatik gönderildi.</p></div>`;
}

function b64(text: string) {
  let bin = ""; new TextEncoder().encode(text).forEach(x => bin += String.fromCharCode(x)); return btoa(bin);
}

async function send(to: string, subject: string, html: string, replyTo: string, icsText: string, icsName = "randevu.ics") {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to: [to], subject, html, reply_to: replyTo,
      attachments: [{ filename: icsName, content: b64(icsText) }],
    }),
  });
  if (!r.ok) console.error("resend", r.status, await r.text());
  return r.ok;
}

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const row = (k: string, v: string) => `<tr><td style="padding:6px 12px 6px 0;color:#56607a">${k}</td><td style="padding:6px 0"><b>${v}</b></td></tr>`;

async function onInsert(id: string) {
  const db0 = db();
  // Kaydı veritabanından oku; yalnızca yeni ve henüz bildirilmemiş randevular için gönder
  const { data: b0, error } = await db0.from("bookings").select("*, slots(ends_at)").eq("id", id).single();
  if (error || !b0) return new Response("not found", { status: 200 });
  const b: any = b0;
  if (b.notified_at || Date.now() - new Date(b.created_at).getTime() > 15 * 60_000) return new Response("skip", { status: 200 });
  const { data: claimed } = await db0.from("bookings").update({ notified_at: new Date().toISOString() })
    .eq("id", id).is("notified_at", null).select("id");
  if (!claimed?.length) return new Response("already", { status: 200 });

  const endIso = b.slots?.ends_at || new Date(new Date(b.starts_at).getTime() + 50 * 60_000).toISOString();
  const when = `${fmtDate(b.starts_at)}, ${fmtTime(b.starts_at)}–${fmtTime(endIso)}`;
  const where = b.type === "online"
    ? "Görüntülü görüşme bağlantısı seanstan önce size ayrıca iletilecek."
    : (OFFICE_ADDRESS ? `Adres: ${OFFICE_ADDRESS}` : "Ofis adresi size ayrıca iletilecek.");
  const first = String(b.name).split(" ")[0];
  const cancelUrl = `${SITE_URL}/iptal.html?t=${b.cancel_token}`;

  // Psikoloğa
  const digits = String(b.phone || "").replace(/\D/g, "").replace(/^0/, "90");
  await send(PSYCHOLOGIST_EMAIL, `Yeni randevu: ${b.name} · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)} · ${b.type === "online" ? "Online" : "Yüz yüze"}`,
    wrap(`<h2 style="margin:0 0 12px">Yeni randevu</h2>
      <table style="border-collapse:collapse;font-size:15px">
        ${row("Danışan", esc(b.name))}${row("Tarih", esc(when))}${row("Tür", esc(typeLabel(b.type)))}
        ${row("Telefon", esc(b.phone))}${b.email ? row("E-posta", esc(b.email)) : ""}${b.note ? row("Not", esc(b.note)) : ""}
      </table>
      <p>${digits ? `<a href="https://wa.me/${digits}">WhatsApp'tan yaz</a> · ` : ""}<a href="${esc(SITE_URL)}/admin.html">Yönetim panelini aç</a></p>`),
    b.email || PSYCHOLOGIST_EMAIL,
    ics(b, endIso, `Seans: ${b.name} (${b.type === "online" ? "Online" : "Yüz yüze"})`, `Telefon: ${b.phone}${b.note ? "\nNot: " + b.note : ""}`));

  // Danışana
  if (b.email) {
    await send(b.email, `Randevunuz onaylandı · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
      wrap(`<p>Merhaba ${esc(first)},</p>
        <p>Psk. Heval Deniz Özdemir ile randevunuz oluşturuldu.</p>
        <p style="background:#f2f6fd;padding:14px 16px;border-radius:10px">
          <b>${esc(when)}</b><br>${esc(typeLabel(b.type))}<br><span style="color:#56607a">${esc(where)}</span></p>
        <p>Ekteki dosyayı açarak randevuyu takviminize ekleyebilirsiniz.</p>
        <p>Randevunuza katılamayacaksanız seanstan en az 24 saat önce aşağıdaki butonla iptal edebilirsiniz.</p>
        <p style="margin:18px 0"><a href="${esc(cancelUrl)}" style="display:inline-block;background:#ffffff;color:#b42318;border:1px solid #b42318;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Randevumu iptal et</a></p>
        <p style="color:#56607a;font-size:13px">Seansa 24 saatten az kaldıysa ya da randevunuzu değiştirmek istiyorsanız${CONTACT_PHONE ? ` <b>${esc(CONTACT_PHONE)}</b> numarasından ya da` : ""} bu e-postayı yanıtlayarak haber verin.</p>
        <p style="color:#56607a;font-size:13px">Kendinize ya da bir başkasına zarar verme riski olan acil durumlarda lütfen beklemeden 112'yi arayın.</p>`),
      PSYCHOLOGIST_EMAIL,
      ics(b, endIso, "Psk. Heval Deniz Özdemir ile seans", where));
  }
  return new Response("ok", { status: 200 });
}

async function onCancel(id: string) {
  const db0 = db();
  const { data: b0 } = await db0.from("bookings").select("*, slots(ends_at)").eq("id", id).single();
  if (!b0) return new Response("not found", { status: 200 });
  const b: any = b0;
  if (b.status !== "iptal" || b.cancel_notified_at) return new Response("skip", { status: 200 });
  const { data: claimed } = await db0.from("bookings").update({ cancel_notified_at: new Date().toISOString() })
    .eq("id", id).is("cancel_notified_at", null).select("id");
  if (!claimed?.length) return new Response("already", { status: 200 });

  const endIso = b.slots?.ends_at || new Date(new Date(b.starts_at).getTime() + 50 * 60_000).toISOString();
  const when = `${fmtDate(b.starts_at)}, ${fmtTime(b.starts_at)}–${fmtTime(endIso)}`;
  const byClient = b.cancelled_by === "danisan";
  const who = byClient ? "danışan tarafından" : "sizin tarafınızdan (yönetim paneli)";
  const first = String(b.name).split(" ")[0];
  const future = new Date(b.starts_at).getTime() > Date.now();

  // Psikoloğa
  await send(PSYCHOLOGIST_EMAIL, `Randevu iptal edildi: ${b.name} · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
    wrap(`<h2 style="margin:0 0 12px;color:#b42318">Randevu iptal edildi</h2>
      <table style="border-collapse:collapse;font-size:15px">
        ${row("Danışan", esc(b.name))}${row("Tarih", esc(when))}${row("Tür", esc(typeLabel(b.type)))}
        ${row("İptal eden", esc(who))}${row("Telefon", esc(b.phone))}${b.email ? row("E-posta", esc(b.email)) : ""}
      </table>
      <p>${future ? "Bu saat randevu sayfasında yeniden açıldı." : ""} <a href="${esc(SITE_URL)}/admin.html">Yönetim panelini aç</a></p>`),
    b.email || PSYCHOLOGIST_EMAIL,
    ics(b, endIso, `Seans: ${b.name}`, "İptal edildi", true), "iptal.ics");

  // Danışana
  if (b.email) {
    const reason = byClient
      ? "İptal talebiniz alındı ve randevunuz iptal edildi."
      : "Randevunuz psikoloğunuz tarafından iptal edildi. Yeni bir saat belirlemek için sizinle iletişime geçilecektir.";
    await send(b.email, `Randevunuz iptal edildi · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
      wrap(`<p>Merhaba ${esc(first)},</p>
        <p>${esc(reason)}</p>
        <p style="background:#fde8e6;padding:14px 16px;border-radius:10px"><b>${esc(when)}</b><br>${esc(typeLabel(b.type))}<br><span style="color:#b42318">İptal edildi</span></p>
        <p>Yeni bir randevu almak isterseniz <a href="${esc(SITE_URL)}/randevu.html">randevu sayfasından</a> size uygun saati seçebilirsiniz.${CONTACT_PHONE ? ` Sorularınız için: <b>${esc(CONTACT_PHONE)}</b>` : ""}</p>
        <p style="color:#56607a;font-size:13px">Ekteki dosyayı açarak randevuyu takviminizden kaldırabilirsiniz.</p>`),
      PSYCHOLOGIST_EMAIL,
      ics(b, endIso, "Psk. Heval Deniz Özdemir ile seans", "İptal edildi", true), "iptal.ics");
  }
  return new Response("ok", { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const id = body?.record?.id;
  if (!id || body?.table !== "bookings") return new Response("ignored", { status: 200 });
  if (body.type === "UPDATE") return onCancel(id);
  return onInsert(id);
});
