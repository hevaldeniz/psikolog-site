// İstatistik paneli sunucu fonksiyonu
//   POST {"action":"sync"}               → Instagram verilerini çeker (günlük cron + paneldeki "Şimdi güncelle")
//   POST {"action":"invite","email":"…"} → panele üye davet eder (yalnızca panel üyesi, iki adımlı doğrulamalı oturum)
// Instagram token'ı yalnızca bu fonksiyon okur; hiçbir yanıtta geri döndürülmez.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SITE_URL = (Deno.env.get("SITE_URL") || "https://pskhevaldenizozdemir.com").replace(/\/+$/, "");
const db = () => createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const V = "v23.0";
const TZ = "Europe/Istanbul";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- tarih yardımcıları (İstanbul = UTC+3, yaz saati yok) ---------- */
const dayStr = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
const dayStartUnix = (s: string) => Math.floor(new Date(`${s}T00:00:00+03:00`).getTime() / 1000);
const addDays = (s: string, n: number) => dayStr(new Date(new Date(`${s}T12:00:00+03:00`).getTime() + n * 86400000));

/* ---------- Graph API ---------- */
class GraphError extends Error { constructor(msg: string, public code = 0, public sub = 0) { super(msg); } }
async function graph(host: string, path: string, params: Record<string, string>, token: string) {
  const u = new URL(`https://${host}/${V}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw new GraphError(String(e.message || `HTTP ${r.status}`).slice(0, 300), e.code || r.status, e.error_subcode || 0);
  }
  return j;
}
function explain(e: unknown) {
  if (e instanceof GraphError) {
    if (e.code === 190) return "Token geçersiz ya da süresi dolmuş. Yeni bir token girilmeli.";
    if (e.code === 10 || e.code === 200 || e.code === 3) return "Token'da gerekli izin yok (insights izni). Ayrıntı: " + e.message;
    if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return "Instagram istek sınırına ulaşıldı; bir saat sonra tekrar denenecek.";
    return "Instagram hatası: " + e.message;
  }
  return "Beklenmeyen hata: " + String((e as Error)?.message || e).slice(0, 300);
}

const ACCOUNT_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_views", "website_clicks", "profile_links_taps"];
const COL: Record<string, string> = {
  reach: "reach", views: "views", accounts_engaged: "accounts_engaged", total_interactions: "interactions",
  likes: "likes", comments: "comments", shares: "shares", saves: "saves",
  profile_views: "profile_views", website_clicks: "website_clicks", profile_links_taps: "profile_links_taps",
};

async function sync(force: boolean) {
  const sb = db();
  const { data: c } = await sb.from("ig_config").select("*").eq("id", 1).maybeSingle();
  if (!c?.token) return { ok: false, reason: "no_token" };
  if (!force && c.last_sync_at && Date.now() - new Date(c.last_sync_at).getTime() < 5 * 60000) return { ok: true, skipped: "recent" };
  await sb.from("ig_config").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);

  let token: string = c.token;
  const host: string = c.host || "graph.instagram.com";
  try {
    // 1) Instagram ile giriş token'ları 60 gün geçerli: haftada bir yenile
    if (host === "graph.instagram.com" && (!c.token_refreshed_at || Date.now() - new Date(c.token_refreshed_at).getTime() > 7 * 86400000)) {
      try {
        const u = new URL("https://graph.instagram.com/refresh_access_token");
        u.searchParams.set("grant_type", "ig_refresh_token"); u.searchParams.set("access_token", token);
        const r = await fetch(u); const j = await r.json();
        if (r.ok && j.access_token) {
          token = j.access_token;
          await sb.from("ig_config").update({
            token, token_refreshed_at: new Date().toISOString(),
            token_expires_at: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
          }).eq("id", 1);
        }
      } catch (_) { /* yenileme başarısızsa mevcut token'la devam */ }
    }

    // 2) Hesap
    let igId: string = c.ig_user_id || "";
    if (host === "graph.facebook.com" && !igId) {
      const acc = await graph(host, "me/accounts", { fields: "instagram_business_account{id,username}" }, token);
      igId = (acc.data || []).map((p: any) => p.instagram_business_account?.id).find(Boolean) || "";
      if (!igId) throw new GraphError("Bu token'a bağlı bir Instagram işletme hesabı bulunamadı. Instagram hesap kimliğini (ID) de girin.");
    }
    const node = host === "graph.instagram.com" ? (igId || "me") : igId;
    const prof = await graph(host, node, {
      fields: host === "graph.instagram.com" ? "user_id,username,followers_count,follows_count,media_count" : "id,username,followers_count,follows_count,media_count",
    }, token);
    if (host === "graph.instagram.com" && !igId) igId = String(prof.user_id || prof.id || "");
    const today = dayStr(new Date());
    await sb.from("ig_daily").upsert({
      day: today, followers: prof.followers_count ?? null, follows: prof.follows_count ?? null,
      media_count: prof.media_count ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "day" });

    // 3) Günlük hesap metrikleri (ilk senkronda son 28 gün, sonra son 3 gün — veriler 48 saate kadar gecikebilir)
    const { count } = await sb.from("ig_daily").select("day", { count: "exact", head: true }).not("reach", "is", null);
    const back = (count ?? 0) < 3 ? 28 : 3;
    let metrics = [...ACCOUNT_METRICS];
    const probe = async (since: number, until: number) => {
      try {
        return await graph(host, `${node}/insights`, { metric: metrics.join(","), period: "day", metric_type: "total_value", since: String(since), until: String(until) }, token);
      } catch (e) {
        if (e instanceof GraphError && (e.code === 190 || e.code === 4 || e.code === 17 || e.code === 32)) throw e;
        // desteklenmeyen metrik varsa tek tek dene, desteklenenleri bırak
        const ok: string[] = [];
        for (const m of metrics) {
          try { await graph(host, `${node}/insights`, { metric: m, period: "day", metric_type: "total_value", since: String(since), until: String(until) }, token); ok.push(m); }
          catch (e2) { if (e2 instanceof GraphError && e2.code === 190) throw e2; }
        }
        if (!ok.length) throw e;
        metrics = ok;
        return await graph(host, `${node}/insights`, { metric: metrics.join(","), period: "day", metric_type: "total_value", since: String(since), until: String(until) }, token);
      }
    };
    let days = 0;
    for (let i = back; i >= 1; i--) {
      const d = addDays(today, -i);
      const res = await probe(dayStartUnix(d), dayStartUnix(addDays(d, 1)));
      const row: Record<string, unknown> = { day: d, updated_at: new Date().toISOString() };
      for (const m of res.data || []) if (COL[m.name]) row[COL[m.name]] = m.total_value?.value ?? null;
      await sb.from("ig_daily").upsert(row, { onConflict: "day" });
      days++;
    }

    // 4) Yeni takipçi (günlük seri; 100 takipçinin altındaki hesaplarda Instagram vermez)
    try {
      const since = dayStartUnix(addDays(today, -Math.min(back, 29)));
      const fc = await graph(host, `${node}/insights`, { metric: "follower_count", period: "day", since: String(since), until: String(dayStartUnix(today)) }, token);
      for (const v of fc.data?.[0]?.values || []) {
        const d = dayStr(new Date(new Date(v.end_time).getTime() - 3600000)); // end_time = ertesi gün 07:00 UTC
        await sb.from("ig_daily").upsert({ day: d, new_followers: v.value ?? null, updated_at: new Date().toISOString() }, { onConflict: "day" });
      }
    } catch (e) { if (e instanceof GraphError && e.code === 190) throw e; }

    // 5) Son 30 gönderi ve metrikleri
    const media = await graph(host, `${node}/media`, {
      fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: "30",
    }, token);
    let mcount = 0;
    for (const m of media.data || []) {
      const row: Record<string, unknown> = {
        id: m.id, ts: m.timestamp, media_type: m.media_type, product_type: m.media_product_type || null,
        caption: (m.caption || "").slice(0, 600), permalink: m.permalink,
        thumb: m.media_type === "VIDEO" ? (m.thumbnail_url || null) : (m.media_url || m.thumbnail_url || null),
        likes: m.like_count ?? null, comments: m.comments_count ?? null, updated_at: new Date().toISOString(),
      };
      for (const set of ["reach,views,saved,shares,total_interactions", "reach,saved,shares,total_interactions", "reach"]) {
        try {
          const ins = await graph(host, `${m.id}/insights`, { metric: set }, token);
          for (const x of ins.data || []) {
            const v = x.values?.[0]?.value ?? x.total_value?.value ?? null;
            const k = ({ reach: "reach", views: "views", saved: "saves", shares: "shares", total_interactions: "interactions" } as Record<string, string>)[x.name];
            if (k) row[k] = v;
          }
          break;
        } catch (e) { if (e instanceof GraphError && (e.code === 190 || e.code === 4 || e.code === 17 || e.code === 32)) throw e; }
      }
      await sb.from("ig_media").upsert(row, { onConflict: "id" });
      mcount++;
    }

    await sb.from("ig_config").update({
      username: prof.username || c.username, ig_user_id: igId || c.ig_user_id,
      last_ok_at: new Date().toISOString(), last_error: null,
    }).eq("id", 1);
    return { ok: true, username: prof.username, days, media: mcount };
  } catch (e) {
    const msg = explain(e);
    await sb.from("ig_config").update({ last_error: msg }).eq("id", 1);
    return { ok: false, reason: "graph", message: msg };
  }
}

async function invite(req: Request, email: string) {
  const auth = req.headers.get("Authorization") || "";
  const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: allowed } = await user.rpc("is_stats_user");
  if (allowed !== true) return json({ ok: false, reason: "not_allowed" }, 403);
  const { data: me } = await user.auth.getUser();
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, reason: "bad_email" }, 400);

  const sb = db();
  let uid = "", existing = false;
  const inv = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: `${SITE_URL}/istatistik.html` });
  if (inv.error) {
    // zaten hesabı varsa: üyeliğe ekle, mevcut şifresiyle girer
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = list?.users?.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) return json({ ok: false, reason: "invite_failed", message: inv.error.message }, 400);
    uid = u.id; existing = true;
  } else uid = inv.data.user!.id;
  await sb.from("stats_users").upsert({ user_id: uid, email, added_by: me?.user?.id ?? null }, { onConflict: "user_id" });
  return json({ ok: true, existing });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const body = await req.json().catch(() => ({}));
  if (body.action === "sync") return json(await sync(false));
  if (body.action === "invite") return invite(req, body.email);
  return json({ ok: false, reason: "unknown_action" }, 400);
});
