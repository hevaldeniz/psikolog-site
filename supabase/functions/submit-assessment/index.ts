// Supabase Edge Function: test / envanter gönderimini kaydeder ve iki e-posta yollar
// (psikoloğa tam rapor, danışana yanıtlarının kopyası). Kurulum: README, adım 6.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SITE_URL = Deno.env.get("SITE_URL")!;                 // https://www.alanadiniz.com
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL")!;             // "Psk. Heval Deniz Özdemir <form@alanadiniz.com>"
const PSYCHOLOGIST_EMAIL = Deno.env.get("PSYCHOLOGIST_EMAIL")!;
const SEND_SCORES_TO_CLIENT = Deno.env.get("SEND_SCORES_TO_CLIENT") === "true";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Maddeler düz metin ya da { text, options, section } olabilir; seçenekler maddeye özel olabilir
const itemText = (it: any) => typeof it === "string" ? it : it.text;
const itemOpts = (form: any, i: number) => (typeof form.items[i] === "object" && form.items[i].options) || form.options;
const vals = (form: any, i: number) => itemOpts(form, i).map((o: any) => o.value);

// Puanlama: toplam + şiddet bandı, ters maddeler, alt ölçekler, tarama eşikleri (ASRS) ve uyarı bayrakları
function score(form: any, answers: number[]) {
  const none = { score: null as number | null, severity: null as string | null, flags: [] as string[], max: null as number | null, details: [] as string[] };
  if (form.kind !== "scale") return none;
  const sc = form.scoring || {}, mult = sc.multiplier || 1, rev = new Set(sc.reverse || []);
  const v = answers.map((a, i) => rev.has(i + 1) ? Math.min(...vals(form, i)) + Math.max(...vals(form, i)) - a : a);
  const flags = (sc.flags || []).filter((f: any) => (answers[f.item - 1] ?? 0) >= f.min).map((f: any) => f.label);
  const details = (sc.subscales || []).map((s: any) => {
    const sum = s.items.reduce((a: number, n: number) => a + v[n - 1], 0);
    const max = s.items.reduce((a: number, n: number) => a + Math.max(...vals(form, n - 1)), 0);
    return `${s.label}: ${sum} / ${max}`;
  });
  if (sc.screen) {
    const n = sc.screen.thresholds.filter((t: number, i: number) => answers[i] >= t).length;
    return { score: n, max: answers.length, severity: n >= sc.screen.cutoff ? sc.screen.positive : sc.screen.negative, flags, details };
  }
  if (sc.total === false) return { ...none, severity: details.join(" · ") || null, flags, details };
  const total = v.reduce((a, x) => a + x, 0) * mult;
  const band = (sc.bands || []).find((b: any) => total <= b.max);
  const max = form.items.reduce((a: number, _: any, i: number) => a + Math.max(...vals(form, i)), 0) * mult;
  return { score: total, severity: band?.label ?? (details.join(" · ") || null), flags, max, details };
}

function answerRows(form: any, answers: any) {
  if (form.kind === "scale") {
    return form.items.map((it: any, i: number) => {
      const sec = typeof it === "object" && it.section ? `<tr><td colspan="2" style="padding:12px 8px 4px;font-weight:bold;color:#2667ff">${esc(it.section.title)}</td></tr>` : "";
      const o = itemOpts(form, i).find((x: any) => x.value === answers[i]);
      return `${sec}<tr><td style="padding:8px;border-bottom:1px solid #e3e8f2">${i + 1}. ${esc(itemText(it))}</td><td style="padding:8px;border-bottom:1px solid #e3e8f2"><b>${esc(o?.label)}</b> (${esc(answers[i])})</td></tr>`;
    }).join("");
  }
  return form.fields.map((f: any) =>
    `<tr><td style="padding:8px;border-bottom:1px solid #e3e8f2;vertical-align:top">${esc(f.label)}</td><td style="padding:8px;border-bottom:1px solid #e3e8f2">${esc(answers[f.id]) || "—"}</td></tr>`).join("");
}

function wrap(inner: string) {
  return `<div style="font-family:Arial,sans-serif;color:#141a2e;max-width:640px;margin:auto;line-height:1.55">${inner}
  <p style="font-size:12px;color:#56607a;margin-top:24px">Bu e-posta ${esc(SITE_URL)} üzerindeki form aracılığıyla gönderildi.</p></div>`;
}

async function send(to: string, subject: string, html: string, replyTo?: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: replyTo }),
  });
  if (!r.ok) console.error("resend", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json" }); }
  if (body.website) return json({ ok: true, flagged: false }); // bot tuzağı

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 160);
  const phone = String(body.phone || "").trim().slice(0, 30);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid" });

  const formsRes = await fetch(`${SITE_URL}/assets/forms/forms.json`);
  if (!formsRes.ok) return json({ ok: false, error: "forms_unavailable" });
  const form = (await formsRes.json()).forms.find((f: any) => f.id === body.form_id);
  if (!form) return json({ ok: false, error: "unknown_form" });

  // Yanıt doğrulama
  let answers: any;
  if (form.kind === "scale") {
    if (!Array.isArray(body.answers) || body.answers.length !== form.items.length || !body.answers.every((v: any, i: number) => vals(form, i).includes(v)))
      return json({ ok: false, error: "invalid_answers" });
    answers = body.answers;
  } else {
    answers = {};
    for (const f of form.fields) {
      const v = String(body.answers?.[f.id] ?? "").trim().slice(0, 1500);
      if (f.required && !v) return json({ ok: false, error: "invalid_answers" });
      answers[f.id] = v;
    }
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Kötüye kullanım sınırı: aynı e-postadan saatte en fazla 5 form
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("assessments").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since);
  if ((count ?? 0) >= 5) return json({ ok: false, error: "rate_limited" });

  const r = score(form, answers);
  const { error } = await db.from("assessments").insert({
    form_id: form.id, form_title: form.title, name, email, phone: phone || null,
    answers, score: r.score, severity: r.severity, flags: r.flags,
  });
  if (error) { console.error(error); return json({ ok: false, error: "db" }); }

  const flagged = r.flags.length > 0;
  const rows = answerRows(form, answers);
  const sev = r.severity && r.severity !== r.details.join(" · ") ? ` — ${esc(r.severity)}` : "";
  const scoreLine = (r.score !== null ? `<p style="font-size:18px"><b>Puan: ${r.score} / ${r.max}</b>${sev}</p>` : "")
    + (r.details.length ? `<p style="background:#f2f6fd;padding:12px 14px;border-radius:8px">${r.details.map(esc).join("<br>")}</p>` : "");
  const flagHtml = flagged ? `<p style="background:#fde8e6;color:#b42318;padding:12px;border-radius:8px"><b>DİKKAT:</b> ${r.flags.map(esc).join("<br>")}</p>` : "";

  // Psikoloğa
  await send(PSYCHOLOGIST_EMAIL,
    `${flagged ? "⚠ DİKKAT — " : ""}${form.title}: ${name}${r.score !== null ? ` (${r.score})` : ""}`,
    wrap(`<h2 style="margin:0 0 8px">${esc(form.title)}</h2>
      <p>${esc(name)} · <a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? " · " + esc(phone) : ""}</p>
      ${flagHtml}${scoreLine}
      <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>`),
    email);

  // Danışana
  const crisis = flagged ? `<p style="background:#fde8e6;padding:12px;border-radius:8px"><b>Kendinizi güvende hissetmiyorsanız lütfen beklemeyin:</b> hemen 112'yi arayın ya da en yakın acil servise başvurun.</p>` : "";
  await send(email, `${form.title} yanıtlarınız`,
    wrap(`<p>Merhaba ${esc(name.split(" ")[0])},</p>
      <p>${esc(form.title)} formunu doldurduğunuz için teşekkürler. Yanıtlarınız psikoloğunuza iletildi; kopyası aşağıda.</p>
      ${crisis}${SEND_SCORES_TO_CLIENT ? scoreLine : ""}
      <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
      <p style="color:#56607a;font-size:13px">Bu form tanı koymaz. Sonuçları seansta birlikte değerlendireceğiz.</p>`),
    PSYCHOLOGIST_EMAIL);

  return json({ ok: true, flagged });
});
