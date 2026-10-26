// Supabase Edge Function: randevu e-postaları.
//  - Yeni randevu (INSERT): danışana onay (iptal butonlu), psikoloğa bildirim. Tek gönderim: notified_at.
//  - İptal (UPDATE → status 'iptal'): danışana ve psikoloğa iptal bildirimi. Tek gönderim: cancel_notified_at.
//  - Hatırlatma ({type:"REMINDERS"}, saatlik pg_cron görevi): seanstan 3 gün ve 1 gün önce danışana, iptal butonlu.
//    Tek gönderim: claim_reminders() reminder3_sent_at / reminder1_sent_at alanlarını atomik işaretler.
//  - SMS (Netgsm): randevu onayı, 1 gün önce hatırlatma, iptal. Yalnızca NETGSM_USERCODE, NETGSM_PASSWORD ve
//    NETGSM_HEADER secrets girildiyse çalışır; girilmediyse hiçbir SMS gönderilmez. Hatırlatma: claim_sms_reminders().
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
const SMS_USER = Deno.env.get("NETGSM_USERCODE") || "";
const SMS_PASS = Deno.env.get("NETGSM_PASSWORD") || "";
const SMS_HEADER = Deno.env.get("NETGSM_HEADER") || "";
const smsOn = () => !!(SMS_USER && SMS_PASS && SMS_HEADER);
const HOST = (Deno.env.get("SITE_URL") || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
// Türkiye cep numarası → 5XXXXXXXXX; başka biçimler için SMS atlanır
const gsmNo = (p: unknown) => { const t = String(p ?? "").replace(/\D/g, "").slice(-10); return /^5\d{9}$/.test(t) ? t : null; };
const smsWhen = (iso: string) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// Netgsm: bilgilendirme mesajı (filter=0, ticari değil), Türkçe karakter (dil=TR). Başarı yanıtı 00/01/02 + bulkid.
async function sms(phone: unknown, text: string) {
  const no = gsmNo(phone);
  if (!smsOn() || !no) return false;
  try {
    const q = new URLSearchParams({ usercode: SMS_USER, password: SMS_PASS, gsmno: no, message: text, msgheader: SMS_HEADER, dil: "TR", filter: "0" });
    const r = await fetch(`https://api.netgsm.com.tr/sms/send/get?${q}`);
    const t = (await r.text()).trim();
    const ok = /^0[0-2](\s|$)/.test(t);
    if (!ok) console.error("netgsm hata", t.slice(0, 20));
    return ok;
  } catch (e) { console.error("netgsm istek", String(e)); return false; }
}

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
const cancelBlock = (token: string) => `
  <p>Randevunuza katılamayacaksanız lütfen seanstan en az 24 saat önce iptal edin. Aşağıdaki buton seanstan 12 saat öncesine kadar çalışır; seansa 24 saatten az kala yapılan iptaller geç iptal olarak kaydedilir.</p>
  <p style="margin:18px 0"><a href="${esc(`${SITE_URL}/iptal.html?t=${token}`)}" style="display:inline-block;background:#ffffff;color:#b42318;border:1px solid #b42318;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Randevumu iptal et</a></p>
  <p style="color:#56607a;font-size:13px">Seansa 12 saatten az kaldıysa ya da randevunuzu değiştirmek istiyorsanız${CONTACT_PHONE ? ` <b>${esc(CONTACT_PHONE)}</b> numarasından ya da` : ""} bu e-postayı yanıtlayarak haber verin.</p>`;
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

  // Psikoloğa (siteden ve panelden eklenen tüm randevularda)
  const digits = String(b.phone || "").replace(/\D/g, "").replace(/^0/, "90");
  await send(PSYCHOLOGIST_EMAIL, `${b.source === "panel" ? "Randevu eklendi (panel)" : "Yeni randevu"}: ${b.name} · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)} · ${b.type === "online" ? "Online" : "Yüz yüze"}`,
    wrap(`<h2 style="margin:0 0 12px">${b.source === "panel" ? "Panelden eklenen randevu" : "Yeni randevu"}</h2>
      <table style="border-collapse:collapse;font-size:15px">
        ${row("Danışan", esc(b.name))}${row("Tarih", esc(when))}${row("Tür", esc(typeLabel(b.type)))}
        ${row("Telefon", esc(b.phone))}${b.email ? row("E-posta", esc(b.email)) : ""}${b.note ? row("Not", esc(b.note)) : ""}
      </table>
      <p>${digits ? `<a href="https://wa.me/${digits}">WhatsApp'tan yaz</a> · ` : ""}<a href="${esc(SITE_URL)}/admin.html">Yönetim panelini aç</a></p>`),
    b.email || PSYCHOLOGIST_EMAIL,
    ics(b, endIso, `Seans: ${b.name} (${b.type === "online" ? "Online" : "Yüz yüze"})`, `Telefon: ${b.phone}${b.note ? "\nNot: " + b.note : ""}`));

  // Danışana (panelden eklenip "e-posta gönder" seçilmediyse gönderilmez)
  if (b.email && b.notify_client !== false) {
    await send(b.email, `Randevunuz onaylandı · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
      wrap(`<p>Merhaba ${esc(first)},</p>
        <p>Psk. Heval Deniz Özdemir ile randevunuz oluşturuldu.</p>
        <p style="background:#f2f6fd;padding:14px 16px;border-radius:10px">
          <b>${esc(when)}</b><br>${esc(typeLabel(b.type))}<br><span style="color:#56607a">${esc(where)}</span></p>
        <p>Ekteki dosyayı açarak randevuyu takviminize ekleyebilirsiniz.</p>
        ${cancelBlock(b.cancel_token)}
        <p style="color:#56607a;font-size:13px">Kendinize ya da bir başkasına zarar verme riski olan acil durumlarda lütfen beklemeden 112'yi arayın.</p>`),
      PSYCHOLOGIST_EMAIL,
      ics(b, endIso, "Psk. Heval Deniz Özdemir ile seans", where));
  }
  // SMS onayı
  if (b.notify_client !== false && new Date(b.starts_at).getTime() > Date.now())
    await sms(b.phone, `Psk. Heval Deniz Özdemir ile ${smsWhen(b.starts_at)} randevunuz oluşturuldu. İptal: ${HOST}/iptal.html?t=${b.cancel_token}`);
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
  const late = byClient && b.late_cancel;
  const first = String(b.name).split(" ")[0];
  const future = new Date(b.starts_at).getTime() > Date.now();

  // Psikoloğa
  await send(PSYCHOLOGIST_EMAIL, `${late ? "Geç iptal" : "Randevu iptal edildi"}: ${b.name} · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
    wrap(`<h2 style="margin:0 0 12px;color:#b42318">${late ? "Geç iptal (seansa 24 saatten az kala)" : "Randevu iptal edildi"}</h2>
      <table style="border-collapse:collapse;font-size:15px">
        ${row("Danışan", esc(b.name))}${row("Tarih", esc(when))}${row("Tür", esc(typeLabel(b.type)))}
        ${row("İptal eden", esc(who))}${late ? row("Not", "Seansa 24 saatten az kala iptal edildi") : ""}${row("Telefon", esc(b.phone))}${b.email ? row("E-posta", esc(b.email)) : ""}
      </table>
      <p>${future ? "Bu saat randevu sayfasında yeniden açıldı." : ""} <a href="${esc(SITE_URL)}/admin.html">Yönetim panelini aç</a></p>`),
    b.email || PSYCHOLOGIST_EMAIL,
    ics(b, endIso, `Seans: ${b.name}`, "İptal edildi", true), "iptal.ics");

  // Danışana (panelden eklenip "e-posta gönder" seçilmediyse gönderilmez)
  if (b.email && b.notify_client !== false) {
    const reason = byClient
      ? "İptal talebiniz alındı ve randevunuz iptal edildi."
      : "Randevunuz psikoloğunuz tarafından iptal edildi. Yeni bir saat belirlemek için sizinle iletişime geçilecektir.";
    await send(b.email, `Randevunuz iptal edildi · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
      wrap(`<p>Merhaba ${esc(first)},</p>
        <p>${esc(reason)}</p>
        ${late ? `<p style="color:#56607a;font-size:13px">İptaliniz seansa 24 saatten az kala yapıldığı için geç iptal olarak kaydedildi.</p>` : ""}
        <p style="background:#fde8e6;padding:14px 16px;border-radius:10px"><b>${esc(when)}</b><br>${esc(typeLabel(b.type))}<br><span style="color:#b42318">İptal edildi</span></p>
        <p>Yeni bir randevu almak isterseniz <a href="${esc(SITE_URL)}/randevu.html">randevu sayfasından</a> size uygun saati seçebilirsiniz.${CONTACT_PHONE ? ` Sorularınız için: <b>${esc(CONTACT_PHONE)}</b>` : ""}</p>
        <p style="color:#56607a;font-size:13px">Ekteki dosyayı açarak randevuyu takviminizden kaldırabilirsiniz.</p>`),
      PSYCHOLOGIST_EMAIL,
      ics(b, endIso, "Psk. Heval Deniz Özdemir ile seans", "İptal edildi", true), "iptal.ics");
  }
  // SMS iptal bildirimi (gelecekteki seanslar için)
  if (b.notify_client !== false && future)
    await sms(b.phone, `Psk. Heval Deniz Özdemir ile ${smsWhen(b.starts_at)} randevunuz iptal edildi.${CONTACT_PHONE ? ` Bilgi: ${CONTACT_PHONE}` : ""}`);
  return new Response("ok", { status: 200 });
}

async function onReminders() {
  const db0 = db();
  let sent = 0;
  for (const kind of ["3gun", "1gun"] as const) {
    const { data, error } = await db0.rpc("claim_reminders", { p_kind: kind });
    if (error) { console.error("claim_reminders", kind, error.message); continue; }
    const list: any[] = data || [];
    if (!list.length) continue;
    const { data: slots } = await db0.from("slots").select("id, ends_at").in("id", list.map(b => b.slot_id));
    const endOf = new Map((slots || []).map((s: any) => [s.id, s.ends_at]));
    for (const b of list) {
      const endIso = endOf.get(b.slot_id) || new Date(new Date(b.starts_at).getTime() + 50 * 60_000).toISOString();
      const when = `${fmtDate(b.starts_at)}, ${fmtTime(b.starts_at)}–${fmtTime(endIso)}`;
      const where = b.type === "online"
        ? "Görüntülü görüşme bağlantısı seanstan önce size ayrıca iletilecek."
        : (OFFICE_ADDRESS ? `Adres: ${OFFICE_ADDRESS}` : "Ofis adresi size ayrıca iletilecek.");
      const first = String(b.name).split(" ")[0];
      const lead = kind === "3gun" ? "3 gün sonra" : "yarın";
      const ok = await send(b.email, `Hatırlatma: seansınız ${lead} · ${fmtDate(b.starts_at)} ${fmtTime(b.starts_at)}`,
        wrap(`<p>Merhaba ${esc(first)},</p>
          <p>Psk. Heval Deniz Özdemir ile seansınızın ${esc(lead)} olduğunu hatırlatmak isteriz.</p>
          <p style="background:#f2f6fd;padding:14px 16px;border-radius:10px">
            <b>${esc(when)}</b><br>${esc(typeLabel(b.type))}<br><span style="color:#56607a">${esc(where)}</span></p>
          ${cancelBlock(b.cancel_token)}
          <p style="color:#56607a;font-size:13px">Kendinize ya da bir başkasına zarar verme riski olan acil durumlarda lütfen beklemeden 112'yi arayın.</p>`),
        PSYCHOLOGIST_EMAIL,
        ics(b, endIso, "Psk. Heval Deniz Özdemir ile seans", where));
      if (ok) sent++;
    }
  }
  // SMS hatırlatma (seanstan yaklaşık 1 gün önce); SMS kapalıyken kayıtlar işaretlenmez
  let smsSent = 0;
  if (smsOn()) {
    const { data, error } = await db0.rpc("claim_sms_reminders");
    if (error) console.error("claim_sms_reminders", error.message);
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + 86400000));
    for (const b of (data || []) as any[]) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(b.starts_at)) === tomorrow ? "Yarın" : "Bugün";
      if (await sms(b.phone, `Hatırlatma: ${day} ${fmtTime(b.starts_at)} Psk. Heval Deniz Özdemir ile randevunuz var. İptal: ${HOST}/iptal.html?t=${b.cancel_token}`)) smsSent++;
    }
  }
  return new Response(`reminders ${sent} sms ${smsSent}`, { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (body?.type === "REMINDERS") return onReminders();
  const id = body?.record?.id;
  if (!id || body?.table !== "bookings") return new Response("ignored", { status: 200 });
  if (body.type === "UPDATE") return onCancel(id);
  return onInsert(id);
});
