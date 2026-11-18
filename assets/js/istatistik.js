/* İstatistik paneli: site ziyaretleri (çerezsiz sayaç), isimsiz randevu/test toplamları ve Instagram verileri.
   Erişim: stats_users tablosundaki üyeler + iki adımlı doğrulama. Danışan kişisel verisi bu sayfaya hiç gelmez. */
(function () {
  const C = window.SITE_CONFIG, sb = Data.sb;
  // Demo görünümü yalnızca Supabase hiç ayarlanmamışsa (yerel geliştirme). Canlıda kütüphane yüklenemezse
  // panel açılmaz, giriş ekranında hata gösterilir.
  const DEMO = !sb && !C.supabaseUrl;
  const BROKEN = !sb && !!C.supabaseUrl;
  const $ = id => document.getElementById(id);
  const TZ = "Europe/Istanbul";
  const nf = new Intl.NumberFormat("tr-TR");
  const num = v => v == null ? "—" : nf.format(v);
  const esc = s => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  const note = (el, text, kind) => { el.hidden = !text; el.className = `notice ${kind || "err"}`; el.textContent = text || ""; };
  const dayKey = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const addDays = (s, n) => dayKey(new Date(new Date(`${s}T12:00:00+03:00`).getTime() + n * 86400000));
  const dShort = s => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(`${s}T12:00:00+03:00`));
  const dLong = s => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "long", weekday: "short" }).format(new Date(`${s}T12:00:00+03:00`));
  const dt = iso => iso ? new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

  // Davet / şifre sıfırlama bağlantısından gelindiyse (Supabase adresin # kısmına yazar)
  const hash = new URLSearchParams(location.hash.slice(1));
  let needPassword = ["invite", "recovery"].includes(hash.get("type"));
  const linkError = hash.get("error_code") || hash.get("error");

  /* ================= Oturum akışı ================= */
  const VIEWS = ["login", "pass", "mfa", "denied", "app"];
  function show(v) { VIEWS.forEach(x => { $(`${x}-view`).hidden = x !== v; }); $("logout").hidden = v === "login"; }
  let mfaFactorId = null, started = false;

  async function boot() {
    if (DEMO) { show("app"); return start(); }
    if (BROKEN) {
      show("login"); $("login-form").querySelector("button[type=submit]").disabled = true;
      return note($("login-msg"), "Giriş servisine bağlanılamadı. Reklam engelleyiciyi bu sayfada kapatıp sayfayı yenileyin.");
    }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      show("login");
      if (linkError) note($("login-msg"), "Bağlantının süresi dolmuş ya da daha önce kullanılmış. Şifrenizi belirlemek için \"Şifremi unuttum\"a basın.", "warn");
      return;
    }
    let lvl;
    try { const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if (error) throw error; lvl = data; }
    catch (e) { await sb.auth.signOut(); return show("login"); }

    // Üye değilse doğrulama kurdurmadan durdur
    const { data: member } = await sb.rpc("stats_is_member");
    if (member !== true) return show("denied");

    if (needPassword && (lvl.currentLevel === "aal2" || lvl.nextLevel === "aal1")) {
      $("pass-title").textContent = hash.get("type") === "recovery" ? "Yeni şifre belirleyin" : "Hoş geldiniz — şifrenizi belirleyin";
      return show("pass");
    }
    if (lvl.currentLevel !== "aal2") return startMfa();
    show("app"); start();
  }

  async function startMfa() {
    show("mfa"); note($("mfa-msg"), ""); $("mfa-code").value = "";
    try {
      const { data } = await sb.auth.mfa.listFactors();
      const totp = (data.all || []).filter(f => f.factor_type === "totp");
      const verified = totp.find(f => f.status === "verified");
      if (verified) {
        mfaFactorId = verified.id; $("mfa-setup").hidden = true;
        $("mfa-title").textContent = "Doğrulama kodu";
        $("mfa-hint").textContent = "Doğrulama uygulamanızdaki 6 haneli kodu girin.";
      } else {
        for (const f of totp) await sb.auth.mfa.unenroll({ factorId: f.id });
        const { data: en, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "İstatistik paneli " + new Date().toISOString().slice(0, 10) });
        if (error) throw error;
        mfaFactorId = en.id; $("mfa-qr").src = en.totp.qr_code; $("mfa-secret").textContent = en.totp.secret; $("mfa-setup").hidden = false;
        $("mfa-title").textContent = "İki adımlı doğrulamayı kurun";
        $("mfa-hint").textContent = "Kurulumdan sonra uygulamada görünen 6 haneli kodu girin. Bu kurulum bir kez yapılır.";
      }
    } catch (e) { note($("mfa-msg"), "Doğrulama başlatılamadı. Sayfayı yenileyip tekrar deneyin."); }
    $("mfa-code").focus();
  }

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("login-msg"), "");
    const { error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value });
    $("l-pass").value = "";
    if (error) return note($("login-msg"), "E-posta ya da şifre hatalı.");
    boot();
  });
  $("forgot").onclick = async () => {
    const email = $("l-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return note($("login-msg"), "Önce e-posta adresinizi yazın, sonra \"Şifremi unuttum\"a basın.", "warn");
    let ok = false;
    try {
      const r = await fetch(`${C.supabaseUrl}/functions/v1/istatistik`, { method: "POST", headers: { "Content-Type": "application/json", apikey: C.supabaseAnonKey, Authorization: `Bearer ${C.supabaseAnonKey}` }, body: JSON.stringify({ action: "reset", email }) });
      ok = r.ok;
    } catch (e) {}
    note($("login-msg"), ok ? "Bu adres panele kayıtlıysa şifre belirleme bağlantısı gönderildi. E-postanızı (ve istenmeyen klasörünü) kontrol edin." : "Bağlantı gönderilemedi, biraz sonra tekrar deneyin.", ok ? "ok" : "err");
  };
  $("pass-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("pass-msg"), "");
    const a = $("p-new").value, b = $("p-new2").value;
    if (a.length < 10) return note($("pass-msg"), "Şifre en az 10 karakter olmalı.");
    if (a !== b) return note($("pass-msg"), "İki şifre aynı değil.");
    const { error } = await sb.auth.updateUser({ password: a });
    $("p-new").value = $("p-new2").value = "";
    if (error) return note($("pass-msg"), "Şifre kaydedilemedi: " + error.message);
    needPassword = false; history.replaceState(null, "", location.pathname);
    boot();
  });
  $("mfa-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("mfa-msg"), "");
    const code = $("mfa-code").value.replace(/\D/g, "");
    if (code.length !== 6) return note($("mfa-msg"), "Kod 6 haneli olmalı.");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code });
    if (error) { $("mfa-code").value = ""; return note($("mfa-msg"), "Kod hatalı ya da süresi doldu. Uygulamadaki güncel kodu girin."); }
    boot();
  });
  async function logout() { if (sb) await sb.auth.signOut(); started = false; location.replace(location.pathname); }
  $("logout").onclick = logout; $("mfa-cancel").onclick = logout; $("denied-out").onclick = logout;

  /* ================= Sekmeler ve tarih aralığı ================= */
  const TABS = ["ozet", "site", "ig", "ayar"];
  function tab(name) {
    TABS.forEach(t => { $(`t-${t}`).setAttribute("aria-selected", t === name); $(`p-${t}`).hidden = t !== name; });
    try { sessionStorage.setItem("st_tab", name); } catch (e) {}
    redrawCharts();
  }
  TABS.forEach(t => $(`t-${t}`).addEventListener("click", () => tab(t)));

  function range() {
    const v = $("range").value, today = dayKey(new Date());
    if (v === "month") return { from: today.slice(0, 8) + "01", to: today };
    if (v === "prevmonth") { const first = today.slice(0, 8) + "01", end = addDays(first, -1); return { from: end.slice(0, 8) + "01", to: end }; }
    const n = +v; return { from: addDays(today, -(n - 1)), to: today };
  }

  async function start() {
    if (started) return; started = true;
    try { const t = sessionStorage.getItem("st_tab"); if (t && TABS.includes(t)) tab(t); } catch (e) {}
    try { $("notrack").checked = localStorage.getItem("psk_notrack") === "1"; } catch (e) {}
    utm();
    await load();
    loadSettings();
  }
  $("range").addEventListener("change", load);
  $("reload").addEventListener("click", load);

  /* ================= Veri ================= */
  let S = null, IG = { daily: [], media: [], status: null }, R = null;
  async function load() {
    R = range();
    $("range-note").textContent = `${dLong(R.from)} – ${dLong(R.to)} · önceki dönemle karşılaştırmalı`;
    try {
      if (DEMO) { S = demoStats(R); IG = demoIg(R); }
      else {
        const [ov, daily, media, status, last] = await Promise.all([
          sb.rpc("stats_overview", { p_from: R.from, p_to: R.to }),
          sb.from("ig_daily").select("*").gte("day", addDays(R.from, -(dayDiff(R) + 1))).lte("day", R.to).order("day"),
          sb.from("ig_media").select("*").order("ts", { ascending: false }).limit(60),
          sb.rpc("ig_status"),
          sb.from("ig_daily").select("day, followers").not("followers", "is", null).order("day", { ascending: false }).limit(1),
        ]);
        if (ov.error) throw ov.error;
        S = ov.data;
        IG = { daily: daily.data || [], media: media.data || [], status: status.data || null, last: (last.data || [])[0] || null };
      }
    } catch (e) {
      $("kpi-ozet").innerHTML = `<div class="notice err" style="grid-column:1/-1">Veriler yüklenemedi. ${esc(e.message || "")}</div>`;
      return;
    }
    render();
  }
  const dayDiff = r => Math.round((new Date(r.to) - new Date(r.from)) / 86400000);

  /* ================= Çizim ================= */
  function delta(cur, prev) {
    if (prev == null || cur == null) return "";
    if (!prev) return cur ? `<small>önceki dönem: 0</small>` : `<small>önceki dönem: 0</small>`;
    const p = Math.round(((cur - prev) / prev) * 100);
    if (p === 0) return `<small>önceki döneme göre aynı</small>`;
    return `<small><span class="${p > 0 ? "up" : "down"}">${p > 0 ? "▲" : "▼"} %${Math.abs(p)}</span> önceki döneme göre</small>`;
  }
  const kpi = (label, val, extra = "") => `<div class="kpi"><span>${esc(label)}</span><b>${typeof val === "number" ? num(val) : esc(val)}</b>${extra}</div>`;

  function hbars(el, rows, opts = {}) {
    if (!rows || !rows.length) { el.innerHTML = `<p class="st-empty">${opts.empty || "Bu dönemde veri yok."}</p>`; return; }
    const max = Math.max(...rows.map(r => r.n), 1), tot = rows.reduce((a, r) => a + r.n, 0);
    el.innerHTML = `<ul class="hbars">${rows.map(r => `<li><span class="k" title="${esc(r.label || r.k)}">${esc(r.label || r.k)}</span><span class="n">${num(r.n)}${opts.pct && tot ? ` · %${Math.round(r.n / tot * 100)}` : ""}</span><span class="t"><i style="width:${(r.n / max * 100).toFixed(1)}%"></i></span></li>`).join("")}</ul>`;
  }

  const PAGES = { "/": "Ana sayfa", "/randevu": "Randevu", "/testler": "Testler", "/test": "Ön değerlendirme formu", "/iptal": "Randevu yönetimi (iptal/değişiklik)", "/kvkk": "KVKK metni", "/r/": "SMS kısa bağlantısı" };
  const pageLabel = p => PAGES[p] || p;
  const DEV = { mobil: "Mobil", masaustu: "Masaüstü", tablet: "Tablet", bilinmiyor: "Bilinmiyor" };
  const EVENTS = [["whatsapp", "WhatsApp tıklaması"], ["telefon", "Telefon tıklaması"], ["eposta", "E-posta tıklaması"], ["instagram", "Instagram bağlantısı"], ["harita", "Yol tarifi / harita"], ["randevu_tamam", "Tamamlanan randevu talebi"], ["test_tamam", "Gönderilen test"]];

  // SVG grafik: tek seri, tek eksen; çizgi ya da çubuk. Üzerine gelince ipucu.
  const charts = {};
  function chart(id, pts, o) { charts[id] = { pts, o }; drawChart(id); }
  function redrawCharts() { Object.keys(charts).forEach(drawChart); }
  function niceMax(v) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function drawChart(id) {
    const el = $(id); if (!el || !charts[id]) return;
    const { pts, o } = charts[id];
    const W = Math.max(el.clientWidth || 600, 260), H = o.h || 220, L = 40, Rr = 12, T = 12, B = 26;
    const pw = W - L - Rr, ph = H - T - B;
    const vals = pts.map(p => p.y).filter(v => v != null);
    if (!vals.length || (o.hideZero && !vals.some(v => v))) {
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H / 2}" role="img" aria-label="Veri yok"><text class="empty" x="${W / 2}" y="${H / 4}" text-anchor="middle">${o.empty || "Bu dönemde veri yok."}</text></svg>`; return;
    }
    let lo = o.minZero === false ? Math.min(...vals) : 0, hi = Math.max(...vals);
    if (o.minZero === false) { const pad = Math.max(1, Math.round((hi - lo) * 0.15)); lo = Math.max(0, lo - pad); hi = hi + pad; }
    hi = o.minZero === false ? hi : niceMax(hi);
    if (hi === lo) hi = lo + 1;
    const n = pts.length, bw = pw / n;
    const x = i => o.type === "bar" ? L + bw * i + bw / 2 : L + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = v => T + ph - ((v - lo) / (hi - lo)) * ph;
    const ticks = o.minZero === false ? 4 : (hi % 4 === 0 ? 4 : 5), grid = [];
    for (let k = 0; k <= ticks; k++) {
      const v = lo + ((hi - lo) * k) / ticks, yy = y(v).toFixed(1);
      grid.push(`<line x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}"/>`);
      grid.push(`<text x="${L - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${nf.format(Math.round(v))}</text>`);
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 64))));
    const showX = i => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.9);
    const xl = pts.map((p, i) => showX(i) ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === n - 1 && n > 1 && o.type !== "bar" ? "end" : "middle"}">${esc(p.label)}</text>` : "").join("");
    let marks = "";
    if (o.type === "bar") {
      const w = Math.max(2, Math.min(28, bw - 2));
      marks = pts.map((p, i) => { if (p.y == null) return ""; const top = y(p.y), h = Math.max(0, T + ph - top); const r = Math.min(4, w / 2, h);
        return `<path class="bar" d="M${(x(i) - w / 2).toFixed(1)},${(T + ph).toFixed(1)} v${(-h + r).toFixed(1)} q0,${-r} ${r},${-r} h${(w - 2 * r).toFixed(1)} q${r},0 ${r},${r} v${(h - r).toFixed(1)} z"/>`; }).join("");
    } else {
      const segs = []; let cur = [];
      pts.forEach((p, i) => { if (p.y == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(p.y)]); });
      if (cur.length) segs.push(cur);
      marks = segs.map(s => s.length === 1 ? `<circle class="dot" cx="${s[0][0]}" cy="${s[0][1]}" r="4"/>` :
        (o.area ? `<path class="area" d="M${s[0][0]},${T + ph} ${s.map(q => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ")} L${s[s.length - 1][0]},${T + ph} Z"/>` : "") +
        `<path class="line" d="${s.map((q, k) => `${k ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ")}"/>`).join("");
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "")}">
      <g class="grid">${grid.filter(g => g.startsWith("<line")).join("")}</g>
      <g class="axis">${grid.filter(g => g.startsWith("<text")).join("")}${xl}</g>
      ${marks}<g class="hover" hidden><line class="cross" y1="${T}" y2="${T + ph}"/><circle class="dot" r="5"/></g>
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" class="hit"/></svg>`;
    const svg = el.querySelector("svg"), hov = svg.querySelector(".hover"), tip = $("tip");
    const move = ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * (W / r.width);
      let i = o.type === "bar" ? Math.floor((sx - L) / bw) : Math.round(((sx - L) / pw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i)); const p = pts[i];
      hov.hidden = false;
      hov.querySelector("line").setAttribute("x1", x(i)); hov.querySelector("line").setAttribute("x2", x(i));
      const dot = hov.querySelector("circle");
      if (p.y == null || o.type === "bar") dot.setAttribute("r", 0); else { dot.setAttribute("r", 5); dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.y)); }
      tip.hidden = false; tip.innerHTML = o.tip ? o.tip(p) : `<b>${esc(p.full || p.label)}</b><br>${p.y == null ? "veri yok" : num(p.y)}`;
      const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, ev.clientX + 14), ty = Math.max(8, ev.clientY - tip.offsetHeight - 12);
      tip.style.left = tx + "px"; tip.style.top = ty + "px";
    };
    const out = () => { hov.hidden = true; tip.hidden = true; };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerleave", out); svg.addEventListener("pointerdown", move);
  }
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(redrawCharts, 150); });

  /* ================= Görünümler ================= */
  function render() {
    const t = S.totals, p = S.prev, b = S.bookings || {};
    // Instagram dönem özetleri
    const inRange = IG.daily.filter(d => d.day >= R.from && d.day <= R.to);
    const prevRange = IG.daily.filter(d => d.day < R.from);
    const sum = (rows, k) => rows.some(r => r[k] != null) ? rows.reduce((a, r) => a + (r[k] || 0), 0) : null;
    const fRows = IG.daily.filter(d => d.followers != null);
    const curF = IG.last ? IG.last.followers : (fRows.length ? fRows[fRows.length - 1].followers : null);
    const startF = (fRows.find(d => d.day >= R.from) || {}).followers;
    const fChange = curF != null && startF != null ? curF - startF : null;

    const conv = t.sessions ? (t.web_bookings / t.sessions * 100) : null;
    $("kpi-ozet").innerHTML =
      kpi("Site ziyareti", t.sessions, delta(t.sessions, p.sessions)) +
      kpi("WhatsApp / telefon / e-posta", t.contacts, delta(t.contacts, p.contacts)) +
      kpi("Siteden randevu talebi", t.web_bookings, delta(t.web_bookings, p.web_bookings)) +
      kpi("Doldurulan test", t.tests, delta(t.tests, p.tests)) +
      kpi("Instagram takipçi", curF == null ? "—" : curF, fChange == null ? "<small>Instagram bağlandığında görünür</small>" : `<small>${fChange >= 0 ? "+" : ""}${num(fChange)} bu dönemde</small>`) +
      kpi("Instagram erişim", sum(inRange, "reach") ?? "—", delta(sum(inRange, "reach"), sum(prevRange, "reach")));

    chart("ch-visits", S.daily.map(d => ({ label: dShort(d.d), full: dLong(d.d), y: d.sessions, v: d.views, b: d.bookings })), {
      type: "line", area: true, label: "Günlük ziyaret",
      tip: q => `<b>${esc(q.full)}</b><br>${num(q.y)} ziyaret · ${num(q.v)} görüntüleme${q.b ? `<br>${num(q.b)} randevu talebi` : ""}`,
    });
    hbars($("ozet-sources"), S.sources, { pct: true });
    const igDays = enumerate(R).map(d => { const r = IG.daily.find(x => x.day === d); return { label: dShort(d), full: dLong(d), y: r ? r.reach : null }; });
    chart("ch-ig-mini", igDays, { type: "bar", hideZero: false, h: 180, empty: "Instagram henüz bağlanmadı ya da bu dönemde veri yok.", label: "Instagram günlük erişim" });

    // Web sitesi sekmesi
    $("kpi-site").innerHTML =
      kpi("Ziyaret", t.sessions, delta(t.sessions, p.sessions)) +
      kpi("Sayfa görüntüleme", t.views, delta(t.views, p.views)) +
      kpi("Ziyaret başına sayfa", t.sessions ? (t.views / t.sessions).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—") +
      kpi("Randevuya dönüşüm", conv == null ? "—" : "%" + conv.toLocaleString("tr-TR", { maximumFractionDigits: 1 }), "<small>siteden randevu ÷ ziyaret</small>");
    hbars($("site-sources"), S.sources, { pct: true });
    hbars($("site-pages"), S.pages.map(r => ({ ...r, label: pageLabel(r.k) })));
    hbars($("site-landing"), S.landing.map(r => ({ ...r, label: pageLabel(r.k) })));
    hbars($("site-devices"), S.devices.map(r => ({ ...r, label: DEV[r.k] || r.k })), { pct: true });
    hbars($("site-events"), EVENTS.map(([k, l]) => ({ k, label: l, n: (S.events || {})[k] || 0 })).filter(r => r.n), { empty: "Bu dönemde tıklama kaydı yok." });
    hbars($("site-camps"), S.campaigns, { empty: "Etiketli bağlantıdan gelen ziyaret yok." });
    chart("ch-hours", S.hours.map(h => ({ label: String(h.h).padStart(2, "0"), full: `${String(h.h).padStart(2, "0")}:00–${String(h.h).padStart(2, "0")}:59`, y: h.n })), {
      type: "bar", h: 180, label: "Saatlere göre ziyaret", tip: q => `<b>${q.full}</b><br>${num(q.y)} ziyaret`,
    });
    $("site-bookings").innerHTML = `<dl class="mini-dl">
      <div><dt>Siteden talep</dt><dd>${num(b.web)}</dd></div>
      <div><dt>Online</dt><dd>${num(b.online)}</dd></div>
      <div><dt>Yüz yüze</dt><dd>${num(b.yuzyuze)}</dd></div>
      <div><dt>Panelden eklenen</dt><dd>${num(b.panel)}</dd></div>
      <div><dt>İptal edilen</dt><dd>${num(b.cancelled)}</dd></div></dl>`;
    hbars($("site-tests"), S.tests, { empty: "Bu dönemde test doldurulmadı." });

    renderIg(inRange, prevRange, curF, fChange, sum);
  }
  const enumerate = r => { const out = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d); return out; };

  function renderIg(inRange, prevRange, curF, fChange, sum) {
    const st = IG.status;
    const box = $("ig-state");
    if (!DEMO && (!st || !st.connected)) {
      box.innerHTML = `<div class="notice info">Instagram henüz bağlanmadı. "Erişim ve ayarlar" sekmesinden erişim token'ı girildiğinde veriler her gün otomatik güncellenir.</div>`;
    } else if (st && st.last_error) {
      box.innerHTML = `<div class="notice warn"><b>Son güncelleme başarısız:</b> ${esc(st.last_error)}</div>`;
    } else {
      box.innerHTML = `<p class="small muted">${st && st.username ? `@${esc(st.username)} · ` : ""}Son güncelleme: ${dt(st && st.last_ok_at)}. Instagram verileri 48 saate kadar gecikmeli gelebilir.</p>`;
    }
    $("kpi-ig").innerHTML =
      kpi("Takipçi", curF == null ? "—" : curF, fChange == null ? "" : `<small>${fChange >= 0 ? "+" : ""}${num(fChange)} bu dönemde</small>`) +
      kpi("Erişim", sum(inRange, "reach") ?? "—", delta(sum(inRange, "reach"), sum(prevRange, "reach"))) +
      kpi("Görüntülenme", sum(inRange, "views") ?? "—", delta(sum(inRange, "views"), sum(prevRange, "views"))) +
      kpi("Etkileşim", sum(inRange, "interactions") ?? "—", delta(sum(inRange, "interactions"), sum(prevRange, "interactions"))) +
      kpi("Profil ziyareti", sum(inRange, "profile_views") ?? "—", delta(sum(inRange, "profile_views"), sum(prevRange, "profile_views"))) +
      kpi("Bağlantı tıklaması", (sum(inRange, "website_clicks") ?? sum(inRange, "profile_links_taps")) ?? "—", "<small>profildeki bağlantılar</small>") +
      kpi("Yeni takipçi", sum(inRange, "new_followers") ?? "—", "<small>100 takipçi altında Instagram vermez</small>");
    const days = enumerate(R);
    chart("ch-followers", days.map(d => { const r = IG.daily.find(x => x.day === d); return { label: dShort(d), full: dLong(d), y: r ? r.followers : null }; }),
      { type: "line", minZero: false, empty: "Takipçi geçmişi panel bağlandıktan sonra birikmeye başlar.", label: "Takipçi sayısı" });
    chart("ch-reach", days.map(d => { const r = IG.daily.find(x => x.day === d); return { label: dShort(d), full: dLong(d), y: r ? r.reach : null }; }),
      { type: "bar", empty: "Bu dönemde erişim verisi yok.", label: "Günlük erişim" });
    renderPosts();
  }

  const TYPES = { REELS: "Reels", FEED: "Gönderi", STORY: "Hikâye" };
  function renderPosts() {
    const k = $("ig-sort").value;
    const rows = [...IG.media].sort((a, b) => k === "ts" ? String(b.ts).localeCompare(String(a.ts)) : (b[k] || 0) - (a[k] || 0)).slice(0, 30);
    if (!rows.length) { $("ig-posts").innerHTML = `<p class="st-empty">Gönderi verisi yok.</p>`; return; }
    $("ig-posts").innerHTML = rows.map(m => {
      const type = m.product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Albüm" : m.media_type === "VIDEO" ? "Video" : (TYPES[m.product_type] || "Gönderi");
      return `<a class="ig-post" href="${esc(m.permalink || "#")}" target="_blank" rel="noopener noreferrer">
        <div class="ph">${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(type)}</div>
        <div class="bd"><div class="meta">${esc(type)} · ${m.ts ? dShort(dayKey(new Date(m.ts))) : ""}</div>
        <div class="cap">${esc(m.caption || "")}</div>
        <div class="nums"><span><b>${num(m.reach)}</b>erişim</span><span><b>${num(m.likes)}</b>beğeni</span><span><b>${num(m.comments)}</b>yorum</span>
        <span><b>${num(m.saves)}</b>kaydetme</span><span><b>${num(m.shares)}</b>paylaşım</span><span><b>${num(m.views)}</b>izlenme</span></div></div></a>`;
    }).join("");
    $("ig-posts").querySelectorAll("img").forEach(i => i.addEventListener("error", () => { i.parentElement.textContent = "Görsel süresi doldu"; }));
  }
  $("ig-sort").addEventListener("change", renderPosts);

  /* ================= Ayarlar ================= */
  async function loadSettings() {
    // Instagram bağlantı durumu
    const st = IG.status;
    $("ig-conn").innerHTML = DEMO ? `<p class="notice info">Demo modu.</p>` : !st || !st.connected
      ? `<p class="notice info">Bağlı değil.</p>`
      : `<dl class="mini-dl"><div><dt>Hesap</dt><dd style="font-size:1rem">${st.username ? "@" + esc(st.username) : "—"}</dd></div>
          <div><dt>Bağlantı türü</dt><dd style="font-size:1rem">${esc(st.api || "—")}</dd></div>
          <div><dt>Token girildi</dt><dd style="font-size:1rem">${dt(st.token_set_at)}${st.token_set_by ? `<br><span class="small muted">${esc(st.token_set_by)}</span>` : ""}</dd></div>
          <div><dt>Son başarılı güncelleme</dt><dd style="font-size:1rem">${dt(st.last_ok_at)}</dd></div>
          ${st.token_expires_at ? `<div><dt>Token geçerlilik</dt><dd style="font-size:1rem">${dt(st.token_expires_at)}<br><span class="small muted">her hafta otomatik yenilenir</span></dd></div>` : ""}</dl>
          ${st.last_error ? `<p class="notice warn" style="margin-top:10px">${esc(st.last_error)}</p>` : ""}`;
    $("ig-clear").hidden = $("ig-sync").hidden = !(st && st.connected);
    // Üyeler
    if (DEMO) { $("members").innerHTML = `<li><span>siz@ornek.com<span class="tag">site sahibi</span></span></li><li><span>danisman@ornek.com</span></li>`; return; }
    const { data, error } = await sb.rpc("stats_members");
    if (error) { $("members").innerHTML = `<li>Üyeler yüklenemedi.</li>`; return; }
    $("members").innerHTML = data.map(m => `<li><span>${esc(m.email)}${m.is_owner ? '<span class="tag">site sahibi</span>' : ""}${m.is_me ? '<span class="tag">siz</span>' : ""}</span>
      ${m.is_owner || m.is_me ? "" : `<button class="btn ghost small danger-text" type="button" data-rm="${esc(m.user_id)}">Erişimi kaldır</button>`}</li>`).join("");
    $("members").querySelectorAll("[data-rm]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("Bu kişinin panel erişimi kaldırılsın mı?")) return;
      const { error: e2 } = await sb.rpc("stats_remove_member", { p_user: btn.dataset.rm });
      if (e2) alert("Kaldırılamadı."); loadSettings();
    }));
  }

  async function callFn(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${C.supabaseUrl}/functions/v1/istatistik`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: C.supabaseAnonKey, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ ok: false }));
  }
  async function runSync(msgEl) {
    note(msgEl, "Instagram verileri çekiliyor… İlk seferde bir dakika kadar sürebilir.", "info");
    const res = await callFn({ action: "sync" });
    if (res.ok && res.skipped) note(msgEl, "Veriler birkaç dakika önce güncellendi; tekrar denemek için 5 dakika bekleyin.", "warn");
    else if (res.ok) note(msgEl, `Güncellendi${res.username ? ` (@${res.username})` : ""}: ${res.days} gün, ${res.media} gönderi.`, "ok");
    else note(msgEl, res.message || "Güncellenemedi.", "err");
    await load(); loadSettings();
  }
  $("ig-form").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("ig-msg"); note(msg, "");
    if (DEMO) return note(msg, "Demo modunda kaydedilmez.", "warn");
    const token = $("ig-token").value.trim();
    if (token.length < 20 || /\s/.test(token)) return note(msg, "Token eksik ya da hatalı görünüyor.");
    const { error } = await sb.rpc("ig_set_token", { p_token: token, p_user_id: $("ig-id").value.trim() });
    $("ig-token").value = "";
    if (error) return note(msg, "Kaydedilemedi: " + error.message);
    await runSync(msg);
  });
  $("ig-sync").onclick = () => DEMO ? null : runSync($("ig-msg"));
  $("ig-clear").onclick = async () => {
    if (!confirm("Instagram bağlantısı kaldırılsın mı? Daha önce çekilmiş veriler panelde kalır, yeni veri gelmez.")) return;
    await sb.rpc("ig_clear_token"); await load(); loadSettings();
  };
  $("inv-form").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("inv-msg"); note(msg, "");
    const email = $("inv-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return note(msg, "Geçerli bir e-posta yazın.");
    if (DEMO) return note(msg, "Demo modunda davet gönderilmez.", "warn");
    const res = await callFn({ action: "invite", email });
    if (res.ok) { $("inv-email").value = ""; note(msg, res.existing ? "Bu adresin zaten hesabı vardı; panele eklendi. Mevcut şifresiyle giriş yapabilir." : "Davet gönderildi. Kişi e-postadaki bağlantıyla şifresini belirleyip iki adımlı doğrulamayı kuracak.", "ok"); loadSettings(); }
    else note(msg, res.reason === "not_allowed" ? "Yetkiniz yok." : "Davet gönderilemedi. " + (res.message || ""));
  });
  $("notrack").addEventListener("change", e => { try { e.target.checked ? localStorage.setItem("psk_notrack", "1") : localStorage.removeItem("psk_notrack"); } catch (x) {} });

  function utm() {
    const base = "https://pskhevaldenizozdemir.com/";
    const upd = () => {
      const q = new URLSearchParams({ utm_source: $("u-src").value, utm_medium: $("u-med").value });
      const c = $("u-camp").value.trim().toLowerCase().replace(/[^a-z0-9ğüşıöç_-]+/g, "-").replace(/^-|-$/g, "");
      if (c) q.set("utm_campaign", c);
      $("u-out").textContent = `${base}${$("u-page").value}?${q}`;
    };
    ["u-page", "u-src", "u-med", "u-camp"].forEach(id => $(id).addEventListener("input", upd));
    upd();
    $("u-copy").onclick = async () => { try { await navigator.clipboard.writeText($("u-out").textContent); $("u-copy").textContent = "Kopyalandı"; setTimeout(() => $("u-copy").textContent = "Kopyala", 1500); } catch (e) {} };
  }

  /* ================= Demo verisi (yalnızca Supabase ayarlı değilse) ================= */
  function rnd(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
  function demoStats(r) {
    const R2 = rnd(7), days = enumerate(r);
    const daily = days.map((d, i) => { const s = Math.round(25 + 15 * Math.sin(i / 3) + R2() * 20); return { d, sessions: s, views: Math.round(s * (1.6 + R2())), bookings: R2() > 0.7 ? 1 + Math.round(R2()) : 0 }; });
    const sess = daily.reduce((a, x) => a + x.sessions, 0), views = daily.reduce((a, x) => a + x.views, 0), bk = daily.reduce((a, x) => a + x.bookings, 0);
    return {
      totals: { sessions: sess, views, contacts: Math.round(sess * 0.06), web_bookings: bk, tests: Math.round(sess * 0.04) },
      prev: { sessions: Math.round(sess * 0.85), views: Math.round(views * 0.9), contacts: Math.round(sess * 0.05), web_bookings: Math.max(0, bk - 2), tests: Math.round(sess * 0.05) },
      daily,
      sources: [["Google", 0.38], ["Instagram", 0.27], ["Doğrudan", 0.2], ["Google Ads", 0.1], ["Doktortakvimi", 0.05]].map(([k, f]) => ({ k, n: Math.round(sess * f) })),
      pages: [["/", 0.45], ["/randevu", 0.2], ["/testler", 0.18], ["/test", 0.1], ["/kvkk", 0.02]].map(([k, f]) => ({ k, n: Math.round(views * f) })),
      landing: [["/", 0.7], ["/testler", 0.18], ["/randevu", 0.12]].map(([k, f]) => ({ k, n: Math.round(sess * f) })),
      devices: [["mobil", 0.74], ["masaustu", 0.22], ["tablet", 0.04]].map(([k, f]) => ({ k, n: Math.round(sess * f) })),
      campaigns: [{ k: "bio", n: 42 }, { k: "kasim-kaygi-serisi", n: 17 }],
      events: { whatsapp: 21, telefon: 9, instagram: 14, harita: 6, randevu_tamam: bk, test_tamam: 12 },
      hours: Array.from({ length: 24 }, (_, h) => ({ h, n: Math.round(Math.max(0, 30 * Math.exp(-((h - 21) ** 2) / 18) + 18 * Math.exp(-((h - 12) ** 2) / 10) + R2() * 4)) })),
      bookings: { web: bk, panel: 6, online: Math.round(bk * 0.6), yuzyuze: bk - Math.round(bk * 0.6), cancelled: 2 },
      tests: [{ k: "PHQ-9", n: 9 }, { k: "Bağlanma stilleri", n: 7 }, { k: "Beş Faktör Kişilik", n: 5 }],
    };
  }
  function demoIg(r) {
    const R2 = rnd(3), all = enumerate({ from: addDays(r.from, -(dayDiff(r) + 1)), to: r.to });
    let f = 2380;
    const daily = all.map(d => { f += Math.round(R2() * 9 - 2); const reach = Math.round(300 + R2() * 500); return { day: d, followers: f, reach, views: Math.round(reach * 2.4), interactions: Math.round(reach * 0.08), profile_views: Math.round(reach * 0.1), website_clicks: Math.round(R2() * 6), new_followers: Math.round(R2() * 9) }; });
    const media = Array.from({ length: 9 }, (_, i) => ({ id: "m" + i, ts: new Date(Date.now() - i * 3.5 * 86400000).toISOString(), media_type: i % 3 ? "IMAGE" : "VIDEO", product_type: i % 3 ? "FEED" : "REELS", caption: ["Kaygı ile baş etmenin 3 yolu", "Bağlanma stilleri nedir?", "Terapiye başlamadan önce bilmeniz gerekenler"][i % 3], likes: Math.round(40 + R2() * 200), comments: Math.round(R2() * 20), reach: Math.round(500 + R2() * 3000), views: Math.round(800 + R2() * 6000), saves: Math.round(R2() * 60), shares: Math.round(R2() * 40) }));
    return { daily, media, status: { connected: true, username: "pskhevaldenizozdemir", last_ok_at: new Date().toISOString(), api: "Instagram ile giriş" }, last: daily[daily.length - 1] };
  }

  if (sb) sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") needPassword = true; });
  boot();
})();
