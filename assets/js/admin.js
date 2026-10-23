/* Yönetim paneli */
(function () {
  const F = Data.fmt, C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);
  let slots = [], bookings = [], bf = "upcoming";
  const STATUS = { onayli: ["Onaylı", "ok"], tamamlandi: ["Tamamlandı", "warn"], iptal: ["İptal", "cancel"] };

  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function note(el, text, kind) { el.hidden = !text; el.className = `notice ${kind || "err"}`; el.textContent = text || ""; }

  /* ---------- Oturum ---------- */
  // Görünümler: giriş → iki adımlı doğrulama → panel
  function show(view) {
    $("login-view").hidden = view !== "login"; $("mfa-view").hidden = view !== "mfa";
    $("app-view").hidden = view !== "app"; $("logout").hidden = view === "login";
  }
  let mfaFactorId = null;
  async function boot() {
    if (Data.mode === "demo") $("login-hint").textContent = "Demo modu: herhangi bir e-posta ve şifreyle girebilirsiniz.";
    const s = await Data.session();
    if (!s) { stopIdle(); return show("login"); }
    let level;
    try { level = await Data.aal(); } catch (e) { await Data.signOut(); return show("login"); }
    if (level.current === "aal2") { show("app"); startIdle(); return refresh(); }
    // Şifre doğru ama ikinci adım tamamlanmadı
    show("mfa"); note($("mfa-msg"), ""); $("mfa-code").value = "";
    try {
      const verified = (await Data.mfaFactors()).find(f => f.status === "verified");
      if (verified) {
        mfaFactorId = verified.id; $("mfa-setup").hidden = true;
        $("mfa-title").textContent = "Doğrulama kodu";
        $("mfa-hint").textContent = "Doğrulama uygulamanızdaki 6 haneli kodu girin.";
      } else {
        const en = await Data.mfaEnroll();
        mfaFactorId = en.id; $("mfa-qr").src = en.qr; $("mfa-secret").textContent = en.secret; $("mfa-setup").hidden = false;
        $("mfa-title").textContent = "İki adımlı doğrulamayı kurun";
        $("mfa-hint").textContent = "Kurulumdan sonra uygulamada görünen 6 haneli kodu girin. Bu kurulum bir kez yapılır.";
      }
    } catch (e) { note($("mfa-msg"), "Doğrulama başlatılamadı. Sayfayı yenileyip tekrar deneyin."); }
    $("mfa-code").focus();
  }
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("login-msg"), "");
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { await Data.signIn($("l-email").value.trim(), $("l-pass").value); $("l-pass").value = ""; await boot(); }
    catch (err) { note($("login-msg"), "E-posta veya şifre hatalı."); }
    finally { if (btn) btn.disabled = false; }
  });
  $("mfa-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("mfa-msg"), "");
    const code = $("mfa-code").value.replace(/\D/g, "");
    if (code.length !== 6) return note($("mfa-msg"), "Kod 6 haneli olmalı.");
    try { await Data.mfaVerify(mfaFactorId, code); await boot(); }
    catch (err) { $("mfa-code").value = ""; note($("mfa-msg"), "Kod hatalı ya da süresi doldu. Uygulamadaki güncel kodu girin."); }
  });
  async function logout(reason) {
    stopIdle(); await Data.signOut(); slots = []; bookings = [];
    ["b-rows", "cal", "tests", "stats"].forEach(id => { if ($(id)) $(id).innerHTML = ""; });
    await boot(); if (reason) note($("login-msg"), reason, "warn");
  }
  $("logout").onclick = () => logout();
  $("mfa-cancel").onclick = () => logout();

  // Hareketsizlikte otomatik çıkış (danışan verisi açık kalmasın)
  const IDLE_MIN = 20; let idleTimer = null;
  function bump() { if (!idleTimer) return; clearTimeout(idleTimer); idleTimer = setTimeout(() => logout(`${IDLE_MIN} dakika işlem yapılmadığı için güvenlik amacıyla çıkış yapıldı.`), IDLE_MIN * 60000); }
  function startIdle() { idleTimer = 1; bump(); }
  function stopIdle() { clearTimeout(idleTimer); idleTimer = null; }
  ["click", "keydown", "scroll", "touchstart"].forEach(ev => document.addEventListener(ev, bump, { passive: true }));

  /* ---------- Veri ---------- */
  async function refresh() {
    const from = new Date(Date.now() - 60 * 86400000).toISOString();
    try { [slots, bookings] = await Promise.all([Data.listSlots(from), Data.listBookings()]); }
    catch (e) {
      $("stats").innerHTML = '<div class="notice err" style="grid-column:1/-1">Veriler yüklenemedi. Bu hesabın <b>admins</b> tablosunda kayıtlı olduğundan emin olun (README, adım 2).</div>';
      return;
    }
    renderStats(); renderBookings(); renderWeek(); renderCalendar(); renderTests(); renderSync(); buildClients();
  }

  /* ---------- Takvim aboneliği ---------- */
  async function renderSync() {
    const box = $("sync-body");
    let feed;
    try { feed = await Data.calendarFeed(); }
    catch (e) { box.innerHTML = '<p class="notice err">Takvim bağlantısı yüklenemedi. Veritabanı güncellemesi (supabase/migration-takvim.sql) uygulanmış olmalı.</p>'; return; }
    if (!feed) { box.innerHTML = '<p class="small muted">Demo modunda takvim bağlantısı yok.</p>'; return; }
    const https = Data.calendarFeedUrl(feed.token), webcal = https.replace(/^https:/, "webcal:");
    const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    box.innerHTML = `
      <div class="sync-actions">
        <a class="btn primary" id="sync-apple" href="${esc(webcal)}">Apple Takvim'e ekle</a>
        <a class="btn ghost" id="sync-google" href="${esc(google)}" target="_blank" rel="noopener noreferrer">Google Takvim'e ekle</a>
        <button class="btn ghost" type="button" id="sync-copy">Bağlantıyı kopyala</button>
      </div>
      <label class="check small"><input type="checkbox" id="sync-names" ${feed.show_names ? "checked" : ""}><span>Takvimde danışan adı, telefonu ve notunu göster <span class="muted">(kapalıyken yalnızca "Seans (Online / Yüz yüze)" görünür)</span></span></label>
      <details class="small">
        <summary>Elle ekleme ve ipuçları</summary>
        <ul class="sync-tips">
          <li><b>iPhone:</b> Ayarlar → Takvim → Hesaplar → Hesap Ekle → Diğer → Abone Olunan Takvim Ekle → bağlantıyı yapıştırın. Mac'te: Takvim → Dosya → Yeni Takvim Aboneliği. "Otomatik yenile"yi <b>Her 5 dakikada</b> ya da <b>Her 15 dakikada</b> olarak seçin.</li>
          <li><b>Google Takvim (bilgisayar):</b> Sol menüde "Diğer takvimler" yanındaki + → "URL ile" → bağlantıyı yapıştırın. Telefondaki Google Takvim uygulamasında da otomatik görünür.</li>
          <li>Google abone olunan takvimleri kendi belirlediği aralıklarla (genellikle birkaç saatte bir) yeniler; anlık güncelleme için Apple Takvim daha hızlıdır. Yeni randevu e-postasındaki takvim dosyası anında eklemek için kullanılabilir.</li>
          <li>Bağlantı başka birinin eline geçtiyse aşağıdan yenileyin; eski bağlantı hemen çalışmaz hâle gelir ve takvimlere yeni bağlantıyı tekrar eklemeniz gerekir.</li>
        </ul>
        <p><code class="sync-url" id="sync-url">${esc(https)}</code></p>
        <button class="btn danger small" type="button" id="sync-rotate">Bağlantıyı yenile</button>
      </details>
      <p class="notice ok" id="sync-msg" hidden></p>`;
    $("sync-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(https); note($("sync-msg"), "Bağlantı kopyalandı.", "ok"); }
      catch (e) { note($("sync-msg"), "Kopyalanamadı; 'Elle ekleme' bölümündeki bağlantıyı seçip kopyalayın.", "err"); }
    };
    $("sync-names").onchange = async e => {
      try { await Data.setCalendarNames(e.target.checked); note($("sync-msg"), e.target.checked ? "Danışan bilgileri takvimde gösterilecek." : "Takvimde yalnızca seans türü gösterilecek.", "ok"); }
      catch (err) { e.target.checked = !e.target.checked; note($("sync-msg"), "Ayar kaydedilemedi.", "err"); }
    };
    $("sync-rotate").onclick = async () => {
      if (!confirm("Eski bağlantı çalışmayı durduracak ve takvimlerinize yeni bağlantıyı yeniden eklemeniz gerekecek. Devam edilsin mi?")) return;
      try { await Data.rotateCalendarToken(); await renderSync(); note($("sync-msg"), "Yeni bağlantı oluşturuldu. Takvimlerinizdeki eski aboneliği silip yenisini ekleyin.", "ok"); }
      catch (e) { note($("sync-msg"), "Bağlantı yenilenemedi.", "err"); }
    };
  }

  /* ---------- Testler ---------- */
  let forms = null;
  async function renderTests() {
    const box = $("tests");
    let list;
    try { forms = forms || await Data.loadForms(); list = await Data.listAssessments(); }
    catch (e) { box.innerHTML = '<div class="notice err">Test sonuçları yüklenemedi.</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty">Henüz doldurulmuş form yok. Danışanlarınız Ön değerlendirme ve Testler sayfalarından doldurdukça burada görünür.</div>'; return; }
    box.innerHTML = list.map(a => {
      const f = forms.find(x => x.id === a.form_id), flagged = a.flags && a.flags.length;
      let rows = "";
      if (f && f.kind === "scale") rows = f.items.map((it, i) => { const o = Data.itemOptions(f, i).find(x => x.value === a.answers[i]); return `<div><dt>${i + 1}. ${esc(Data.itemText(it))}</dt><dd>${esc(o ? o.label : a.answers[i])} (${esc(a.answers[i])})</dd></div>`; }).join("");
      else if (f) rows = f.fields.map(fl => `<div><dt>${esc(fl.label)}</dt><dd>${esc(a.answers[fl.id]) || "—"}</dd></div>`).join("");
      return `<details>
        <summary><span>${esc(a.name)} · ${esc(a.form_title)}${a.score != null ? ` · <b style="font-variant-numeric:tabular-nums">${a.score}</b> ${esc(a.severity)}` : ""}
          ${flagged ? ' <span class="pill cancel">Dikkat</span>' : ""}<br><span class="small muted" style="font-weight:400">${esc(F.dateShort(a.created_at))} ${esc(F.time(a.created_at))} · ${esc(a.email)}${a.phone ? " · " + esc(a.phone) : ""}</span></span></summary>
        <div class="stack" style="padding-bottom:16px">
          ${flagged ? `<div class="notice err">${a.flags.map(esc).join("<br>")}</div>` : ""}
          <dl class="answers">${rows}</dl>
        </div></details>`;
    }).join("");
  }

  function renderStats() {
    const now = new Date().toISOString(), week = new Date(Date.now() + 7 * 86400000).toISOString();
    const up = bookings.filter(b => b.status === "onayli" && b.starts_at > now);
    const open = slots.filter(s => s.status === "available" && s.starts_at > now);
    const items = [
      ["Bu hafta seans", up.filter(b => b.starts_at < week).length],
      ["Yaklaşan randevu", up.length],
      ["Açık online saat", open.filter(s => s.type === "online" || s.type === "ikisi").length],
      ["Açık yüz yüze saat", open.filter(s => s.type === "yuzyuze" || s.type === "ikisi").length]
    ];
    $("stats").innerHTML = items.map(([l, v]) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`).join("");
  }

  /* ---------- Randevular: haftalık / günlük takvim ---------- */
  const HPX = 64;                                   // 1 saatin yüksekliği (px)
  const mq = window.matchMedia("(max-width: 760px)");
  let view = "week", wkStart = null, dayKeySel = null, msgTimer = null;
  try { const v = localStorage.getItem("adminView"); if (v) view = v; } catch (e) {}
  if (mq.matches && view === "week") view = "day";
  const mins = iso => { const [h, m] = F.time(iso).split(":").map(Number); return h * 60 + m; };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const keyIso = k => `${k}T12:00:00+03:00`;
  const mondayOf = k => addDays(k, -((new Date(keyIso(k)).getUTCDay() + 6) % 7));
  const DOWS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  function flash(html) {
    const m = $("wk-msg"); m.hidden = false; m.className = "notice ok"; m.innerHTML = html;
    clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.hidden = true; }, 7000);
  }
  function wkGoTo(k) { dayKeySel = k; wkStart = mondayOf(k); }
  function setView(v) {
    view = v; try { localStorage.setItem("adminView", v); } catch (e) {}
    document.querySelectorAll("[data-view]").forEach(x => x.setAttribute("aria-pressed", x.dataset.view === v));
    const list = v === "list";
    $("b-list").hidden = !list; $("wk").hidden = list; $("wk-nav").hidden = list; $("wk-hint").hidden = list;
    renderWeek();
  }
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
  $("wk-prev").onclick = () => { wkGoTo(addDays(dayKeySel, view === "day" ? -1 : -7)); renderWeek(); };
  $("wk-next").onclick = () => { wkGoTo(addDays(dayKeySel, view === "day" ? 1 : 7)); renderWeek(); };
  $("wk-today").onclick = () => { wkGoTo(F.todayKey()); renderWeek(); };
  $("wk-add").onclick = () => openNewBooking(null, view === "day" ? { date: dayKeySel } : null);

  function renderWeek() {
    if (!dayKeySel) wkGoTo(F.todayKey());
    if (view === "list") return;
    const days = view === "day" ? [dayKeySel] : DOWS.map((_, i) => addDays(wkStart, i));
    const inDays = new Set(days), today = F.todayKey(), nowIso = new Date().toISOString();
    const slotById = new Map(slots.map(x => [x.id, x]));
    const bks = bookings.filter(b => b.status !== "iptal" && inDays.has(F.dayKey(b.starts_at)));
    const taken = new Set(bks.map(b => b.slot_id));
    const free = slots.filter(x => x.status === "available" && !taken.has(x.id) && inDays.has(F.dayKey(x.starts_at)));
    const bDur = b => { const sl = slotById.get(b.slot_id); return sl ? Math.round((new Date(sl.ends_at) - new Date(sl.starts_at)) / 60000) : 50; };
    const sDur = x => Math.round((new Date(x.ends_at) - new Date(x.starts_at)) / 60000) || 50;
    let lo = 9 * 60, hi = 20 * 60;
    bks.forEach(b => { lo = Math.min(lo, mins(b.starts_at)); hi = Math.max(hi, mins(b.starts_at) + bDur(b)); });
    free.forEach(x => { lo = Math.min(lo, mins(x.starts_at)); hi = Math.max(hi, mins(x.starts_at) + sDur(x)); });
    lo = Math.floor(lo / 60) * 60; hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
    const H = (hi - lo) / 60 * HPX, y = m => (m - lo) / 60 * HPX;

    const first = days[0], last = days[days.length - 1];
    const fmtD = k => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long" }).format(new Date(keyIso(k)));
    $("wk-label").textContent = view === "day"
      ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(keyIso(first)))
      : `${fmtD(first)} – ${fmtD(last)} ${last.slice(0, 4)}`;

    const head = days.map(k => {
      const d = new Date(keyIso(k)), n = bks.filter(b => F.dayKey(b.starts_at) === k).length;
      return `<div class="wk-dh ${k === today ? "today" : ""}">${DOWS[(d.getUTCDay() + 6) % 7]}<b>${Number(k.slice(8))}</b><small>${n ? `${n} randevu` : "&nbsp;"}</small></div>`;
    }).join("");
    let times = "";
    for (let m = lo; m <= hi; m += 60) times += `<span style="top:${y(m)}px">${hhmm(m)}</span>`;
    const cols = days.map(k => {
      const evs = [];
      free.filter(x => F.dayKey(x.starts_at) === k).forEach(x => {
        const m = mins(x.starts_at), h = Math.max(22, sDur(x) / 60 * HPX - 3);
        evs.push(`<button type="button" class="ev free" data-slot="${x.id}" style="top:${y(m) + 1}px;height:${h}px" aria-label="${esc(F.time(x.starts_at))} boş saat, ${esc(F.typeLabel(x.type))}; randevu ver"><b>${esc(F.time(x.starts_at))}</b><span>Boş · ${esc(F.typeLabel(x.type))}</span></button>`);
      });
      bks.filter(b => F.dayKey(b.starts_at) === k).forEach(b => {
        const m = mins(b.starts_at), h = Math.max(22, bDur(b) / 60 * HPX - 3);
        evs.push(`<button type="button" class="ev ${F.typeClass(b.type)} ${b.status === "tamamlandi" ? "done" : ""}" data-bk="${b.id}" style="top:${y(m) + 1}px;height:${h}px" title="${esc(b.name)} · ${esc(F.time(b.starts_at))}"><b>${esc(F.time(b.starts_at))}</b><span>${esc(b.name)}</span>${h > 58 ? `<span>${esc(F.typeLabel(b.type))}</span>` : ""}</button>`);
      });
      let now = "";
      if (k === today) { const nm = mins(nowIso); if (nm >= lo && nm <= hi) now = `<div class="wk-now" style="top:${y(nm)}px"></div>`; }
      return `<div class="wk-col ${k < today ? "past" : ""}" data-day="${k}" style="height:${H}px">${evs.join("")}${now}</div>`;
    }).join("");
    $("wk").innerHTML = `<div class="wk" style="--days:${days.length};--hpx:${HPX}px">
      <div class="wk-head"><div></div>${head}</div>
      <div class="wk-body"><div class="wk-times" style="height:${H}px">${times}</div>${cols}</div></div>`;
    $("wk").dataset.lo = lo;
  }
  $("wk").addEventListener("click", e => {
    const bk = e.target.closest("[data-bk]");
    if (bk) return openBookingDetail(bk.dataset.bk);
    const fs = e.target.closest("[data-slot]");
    if (fs) return openNewBooking(slots.find(x => x.id === fs.dataset.slot));
    const col = e.target.closest(".wk-col"); if (!col) return;
    // Takvimde boş bir yere tıklama: 15 dakikaya yuvarlanmış saatle yeni randevu
    const lo = +$("wk").dataset.lo, rel = e.clientY - col.getBoundingClientRect().top;
    const m = Math.min(23 * 60 + 45, lo + Math.floor((rel / HPX * 60) / 15) * 15);
    openNewBooking(null, { date: col.dataset.day, time: hhmm(m) });
  });
  mq.addEventListener("change", () => { if (mq.matches && view === "week") setView("day"); });

  /* ---------- Randevu ayrıntısı ---------- */
  function openBookingDetail(id) {
    const b = bookings.find(x => x.id === id); if (!b) return;
    const sl = slots.find(x => x.id === b.slot_id);
    const end = sl ? sl.ends_at : new Date(new Date(b.starts_at).getTime() + 50 * 60000).toISOString();
    const nowIso = new Date().toISOString(), past = b.starts_at <= nowIso;
    const digits = (b.phone || "").replace(/\D/g, "").replace(/^0/, "90");
    const st0 = STATUS[b.status] || [b.status, "ok"];
    const body = $("bk-body");
    body.innerHTML = `
      <div class="modal-head"><h3 id="bk-title">${esc(b.name)}</h3><button class="icon-btn modal-x" type="button" data-close aria-label="Kapat">✕</button></div>
      <dl class="bk-info">
        <dt>Tarih</dt><dd><b>${esc(F.dateLong(b.starts_at))}</b>, ${esc(F.time(b.starts_at))}–${esc(F.time(end))}</dd>
        <dt>Tür</dt><dd><span class="pill ${F.typeClass(b.type)}">${F.typeLabel(b.type)}</span> <span class="pill ${st0[1]}">${st0[0]}</span></dd>
        <dt>Telefon</dt><dd><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>${digits ? ` · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</dd>
        ${b.email ? `<dt>E-posta</dt><dd><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd>` : ""}
        ${b.note ? `<dt>Not</dt><dd>${esc(b.note)}</dd>` : ""}
        <dt>Kaynak</dt><dd class="small muted">${b.source === "panel" ? "Panelden eklendi" : "Siteden alındı"} · ${esc(F.dateShort(b.created_at))} ${esc(F.time(b.created_at))}</dd>
      </dl>
      <div id="bk-msg" hidden></div>
      <div class="modal-actions" id="bk-actions">
        <button class="btn ghost small" type="button" data-bka="again">1 hafta sonra aynı saate randevu</button>
        ${b.status === "onayli" && past ? `<button class="btn ghost small" type="button" data-bka="done">Tamamlandı</button>` : ""}
        ${b.status === "onayli" ? `<button class="btn danger small" type="button" data-bka="ask">Randevuyu iptal et</button>` : ""}
      </div>`;
    body.dataset.id = id;
    if (!$("bk-dialog").open) $("bk-dialog").showModal();
  }
  $("bk-body").addEventListener("click", async e => {
    const btn = e.target.closest("[data-bka]"); if (!btn) return;
    const id = $("bk-body").dataset.id, b = bookings.find(x => x.id === id), act = btn.dataset.bka;
    if (act === "again") {
      const sl = slots.find(x => x.id === b.slot_id);
      $("bk-dialog").close();
      openNewBooking(null, { date: addDays(F.dayKey(b.starts_at), 7), time: F.time(b.starts_at), type: b.type,
        minutes: sl ? Math.round((new Date(sl.ends_at) - new Date(sl.starts_at)) / 60000) : 50 });
      const c = clients.find(x => x.key === phoneKey(b.phone)); if (c) fillClient(c);
      return;
    }
    if (act === "ask") {
      $("bk-actions").innerHTML = `<span class="small" style="flex:1 1 100%">Randevu iptal edilecek, saat yeniden açılacak${b.email ? " ve danışana iptal e-postası gidecek" : ""}. Emin misiniz?</span>
        <button class="btn ghost small" type="button" data-bka="back">Vazgeç</button><button class="btn danger small" type="button" data-bka="cancel">Evet, iptal et</button>`;
      return;
    }
    if (act === "back") return openBookingDetail(id);
    btn.disabled = true;
    try {
      await Data.setBookingStatus(id, act === "cancel" ? "iptal" : "tamamlandi");
      await refresh(); $("bk-dialog").close();
      flash(act === "cancel" ? `${esc(b.name)} randevusu iptal edildi.` : `${esc(b.name)} seansı tamamlandı olarak işaretlendi.`);
    } catch (err) { btn.disabled = false; note($("bk-msg"), "İşlem yapılamadı, tekrar deneyin."); }
  });

  /* ---------- Randevular: liste ---------- */
  document.querySelectorAll("[data-bf]").forEach(b => b.onclick = () => {
    bf = b.dataset.bf; document.querySelectorAll("[data-bf]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderBookings();
  });
  function renderBookings() {
    const now = new Date().toISOString();
    let list = bookings.filter(b =>
      bf === "cancelled" ? b.status === "iptal" :
      bf === "past" ? b.status !== "iptal" && b.starts_at <= now :
      b.status !== "iptal" && b.starts_at > now);
    if (bf !== "upcoming") list = list.slice().reverse();
    const tb = $("b-rows");
    if (!list.length) { tb.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">Bu listede randevu yok.</td></tr>`; return; }
    tb.innerHTML = list.map(b => {
      const st0 = STATUS[b.status] || [b.status, "ok"];
      const st = b.status === "iptal" && b.cancelled_by ? [`İptal · ${b.cancelled_by === "danisan" ? "danışan" : "siz"}${b.late_cancel ? " · geç" : ""}`, "cancel"] : st0;
      const digits = (b.phone || "").replace(/\D/g, "").replace(/^0/, "90");
      const actions = b.status === "onayli"
        ? `<span class="actions" data-id="${b.id}">
             ${b.starts_at <= now ? `<button class="btn ghost small" data-act="done">Tamamlandı</button>` : ""}
             <button class="btn danger small" data-act="ask-cancel">İptal et</button></span>`
        : (b.status === "iptal" && b.starts_at > now ? `<span class="muted small">Saat yeniden açıldı</span>` : "");
      return `<tr>
        <td class="num">${esc(F.dateShort(b.starts_at))}<br><span class="muted small">${esc(F.weekdayShort(b.starts_at))}</span></td>
        <td class="num">${esc(F.time(b.starts_at))}</td>
        <td><span class="pill ${F.typeClass(b.type)}">${F.typeLabel(b.type)}</span></td>
        <td>${esc(b.name)}</td>
        <td class="num">${esc(b.phone)}${digits ? ` · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${b.email ? `<br><span class="muted small">${esc(b.email)}</span>` : ""}</td>
        <td class="small" style="max-width:240px">${esc(b.note)}</td>
        <td><span class="pill ${st[1]}">${st[0]}</span></td>
        <td>${actions}</td></tr>`;
    }).join("");
  }
  $("b-rows").addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const wrap = btn.closest("[data-id]"), id = wrap.dataset.id, act = btn.dataset.act;
    if (act === "ask-cancel") {
      wrap.innerHTML = `<span class="confirm-inline"><span class="small">Randevu iptal edilecek ve danışana iptal e-postası gidecek. Emin misiniz?</span>
        <button class="btn danger small" data-act="cancel">Evet, iptal et</button><button class="btn ghost small" data-act="back">Vazgeç</button></span>`;
      return;
    }
    if (act === "back") return renderBookings();
    btn.disabled = true;
    try { await Data.setBookingStatus(id, act === "cancel" ? "iptal" : "tamamlandi"); await refresh(); }
    catch (err) { btn.disabled = false; btn.textContent = "Hata, tekrar dene"; }
  });

  /* ---------- Takvim ---------- */
  function renderCalendar() {
    const now = new Date().toISOString();
    const upcoming = slots.filter(s => s.starts_at > now);
    const openCount = upcoming.filter(s => s.status === "available").length, bookedCount = upcoming.length - openCount;
    $("cal-count").textContent = `${openCount} boş saat` + (bookedCount ? ` · ${bookedCount} dolu saat (silinmez)` : "");
    resetBulk(openCount);
    const cal = $("cal");
    if (!upcoming.length) { cal.innerHTML = '<div class="empty">Henüz açılmış saat yok. "Saat ekle" sekmesinden ekleyin.</div>'; return; }
    const groups = new Map();
    upcoming.forEach(s => { const k = F.dayKey(s.starts_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    const byslot = new Map(bookings.filter(b => b.status !== "iptal").map(b => [b.slot_id, b]));
    cal.innerHTML = [...groups.values()].map(list => `
      <div class="day-group"><h3>${esc(F.dateLong(list[0].starts_at))}</h3>
        <div class="slot-admin">${list.map(s => {
          const b = byslot.get(s.id), booked = s.status === "booked";
          return `<span class="item ${booked ? "booked" : ""}" data-id="${s.id}">
            <b>${F.time(s.starts_at)}</b>
            ${booked
              ? `<span class="pill ${F.typeClass(b ? b.type : s.type)}">${F.typeLabel(b ? b.type : s.type)}</span><span class="small">${esc(b ? b.name : "Dolu")}</span>`
              : `<button class="icon-btn" data-act="toggle" title="Türü değiştir"><span class="pill ${F.typeClass(s.type)}">${F.typeLabel(s.type)}</span></button>
                 <button class="icon-btn" data-act="book" title="Bu saate randevu ver">+ Randevu</button>
                 <button class="icon-btn" data-act="del" aria-label="Saati sil" title="Sil">✕</button>`}
          </span>`; }).join("")}</div></div>`).join("");
  }
  $("cal").addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const item = btn.closest("[data-id]"), id = item.dataset.id, s = slots.find(x => x.id === id);
    if (btn.dataset.act === "book") return openNewBooking(s);
    if (btn.dataset.act === "del" && !item.dataset.confirm) {
      item.dataset.confirm = "1"; btn.textContent = "Sil?"; btn.style.color = "var(--danger)";
      setTimeout(() => { if (item.isConnected) { delete item.dataset.confirm; btn.textContent = "✕"; btn.style.color = ""; } }, 3000);
      return;
    }
    try {
      if (btn.dataset.act === "del") await Data.deleteSlot(id);
      else await Data.updateSlot(id, { type: ({ online: "yuzyuze", yuzyuze: "ikisi", ikisi: "online" })[s.type] || "online" });
      await refresh();
    } catch (err) { btn.textContent = "!"; }
  });

  /* ---------- Toplu silme ---------- */
  function resetBulk(openCount) {
    $("bulk-wrap").innerHTML = `<button class="btn danger small" type="button" id="bulk-del" ${openCount ? "" : "disabled"}>Tüm boş saatleri sil</button>`;
  }
  $("bulk-wrap").addEventListener("click", async e => {
    const btn = e.target.closest("button"); if (!btn) return;
    const open = slots.filter(s => s.status === "available" && s.starts_at > new Date().toISOString()).length;
    if (btn.id === "bulk-del") {
      $("bulk-wrap").innerHTML = `<span class="confirm-inline"><span class="small">${open} boş saatin hepsi silinecek. Dolu saatler ve randevular kalır. Emin misiniz?</span>
        <button class="btn danger small" type="button" id="bulk-yes">Evet, hepsini sil</button><button class="btn ghost small" type="button" id="bulk-no">Vazgeç</button></span>`;
      return;
    }
    if (btn.id === "bulk-no") return resetBulk(open);
    if (btn.id === "bulk-yes") {
      btn.disabled = true; btn.textContent = "Siliniyor…";
      try { const n = await Data.deleteAllAvailableSlots(); await refresh(); $("cal-count").textContent = `${n} boş saat silindi.`; }
      catch (err) { btn.disabled = false; btn.textContent = "Silinemedi, tekrar dene"; }
    }
  });

  /* ---------- Saat ekle ---------- */
  function addDays(key, n) { const d = new Date(`${key}T12:00:00+03:00`); d.setUTCDate(d.getUTCDate() + n); return F.dayKey(d.toISOString()); }
  $("g-from").value = addDays(F.todayKey(), 1); $("g-to").value = addDays(F.todayKey(), 28);

  function buildRows() {
    const from = $("g-from").value, to = $("g-to").value, st = $("g-start").value, en = $("g-end").value;
    const len = +$("g-len").value, gap = +$("g-gap").value, type = $("g-type").value;
    const days = [...$("g-days").querySelectorAll("input:checked")].map(i => +i.value);
    if (!from || !to || !st || !en || !len || from > to || st >= en || !days.length) return { rows: [], err: "Tarih aralığını, günleri ve saatleri kontrol edin." };
    const existing = new Map(slots.map(s => [new Date(s.starts_at).toISOString(), s]));
    const rows = [], upgrade = []; let skipped = 0, guard = 0;
    for (let k = from; k <= to && guard < 400; k = addDays(k, 1), guard++) {
      const wd = new Date(`${k}T12:00:00+03:00`).getUTCDay(); if (!days.includes(wd)) continue;
      let t = new Date(F.toIso(k, st)).getTime(); const end = new Date(F.toIso(k, en)).getTime();
      while (t + len * 60000 <= end) {
        const iso = new Date(t).toISOString();
        const ex = existing.get(iso);
        // Aynı saatte farklı türde boş bir saat varsa ikisini birleştir: "Online / Yüz yüze"
        if (ex) { if (ex.status === "available" && ex.type !== type && ex.type !== "ikisi") upgrade.push(ex.id); else skipped++; }
        else rows.push({ starts_at: iso, ends_at: new Date(t + len * 60000).toISOString(), type });
        t += (len + gap) * 60000;
      }
    }
    return { rows, skipped, upgrade };
  }
  function preview() {
    const { rows, skipped, upgrade, err } = buildRows();
    const label = F.typeLabel($("g-type").value).toLowerCase();
    $("g-preview").textContent = err || `${rows.length} yeni "${label}" seans saati eklenecek.`
      + (upgrade && upgrade.length ? ` ${upgrade.length} mevcut saat "online / yüz yüze" yapılacak; danışan türü kendisi seçecek.` : "")
      + (skipped ? ` ${skipped} saat zaten var, atlanacak.` : "");
  }
  $("gen-form").addEventListener("input", preview);
  $("gen-form").addEventListener("submit", async e => {
    e.preventDefault();
    const { rows, upgrade, err } = buildRows();
    if (err || (!rows.length && !upgrade.length)) return note($("g-msg"), err || "Eklenecek yeni saat yok.");
    const btn = e.submitter; btn.disabled = true;
    try {
      if (rows.length) await Data.createSlots(rows);
      if (upgrade.length) await Data.updateSlots(upgrade, { type: "ikisi" });
      note($("g-msg"), `${rows.length} saat eklendi${upgrade.length ? `, ${upgrade.length} saat "online / yüz yüze" yapıldı` : ""}. Randevu sayfasında görünüyor.`, "ok");
      await refresh(); preview();
    }
    catch (er) { note($("g-msg"), "Saatler eklenemedi. Bağlantınızı ve yönetici yetkinizi kontrol edin."); }
    finally { btn.disabled = false; }
  });

  /* ---------- Danışan profilleri (randevu kayıtlarından, telefona göre) ---------- */
  let clients = [];
  const phoneKey = p => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };
  function buildClients() {
    const now = new Date().toISOString(), map = new Map();
    // En eski → en yeni sırayla: son randevudaki ad/e-posta geçerli olur
    [...bookings].sort((a, b) => (a.created_at || a.starts_at).localeCompare(b.created_at || b.starts_at)).forEach(b => {
      const k = phoneKey(b.phone); if (!k) return;
      const c = map.get(k) || { key: k, name: b.name, phone: b.phone, email: null, total: 0, done: 0, last: null, next: null };
      c.name = b.name; c.phone = b.phone; if (b.email) c.email = b.email;
      if (b.status !== "iptal") {
        c.total++;
        if (b.starts_at <= now) { c.done++; if (!c.last || b.starts_at > c.last) c.last = b.starts_at; }
        else if (!c.next || b.starts_at < c.next) c.next = b.starts_at;
      }
      map.set(k, c);
    });
    clients = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
    $("nb-clients").innerHTML = clients.map(c => `<option value="${esc(`${c.name} · ${c.phone}`)}"></option>`).join("");
    renderClients();
  }
  function renderClients() {
    const q = $("cl-q").value.trim().toLocaleLowerCase("tr"), qd = q.replace(/\D/g, "");
    const list = clients.filter(c => !q || c.name.toLocaleLowerCase("tr").includes(q) || (c.email || "").toLowerCase().includes(q) || (qd.length >= 3 && phoneKey(c.phone).includes(qd.replace(/^0/, ""))));
    const tb = $("cl-rows");
    if (!list.length) { tb.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:28px">${clients.length ? "Aramayla eşleşen danışan yok." : "Henüz randevu alan danışan yok."}</td></tr>`; return; }
    tb.innerHTML = list.map(c => {
      const digits = c.phone.replace(/\D/g, "").replace(/^0/, "90");
      return `<tr>
        <td><b>${esc(c.name)}</b></td>
        <td class="num">${esc(c.phone)}${digits ? ` · <a href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${c.email ? `<br><span class="muted small">${esc(c.email)}</span>` : ""}</td>
        <td class="num">${c.total}${c.done !== c.total ? ` <span class="muted small">(${c.done} geçmiş)</span>` : ""}</td>
        <td class="num">${c.last ? esc(F.dateShort(c.last)) : "—"}</td>
        <td class="num">${c.next ? `${esc(F.dateShort(c.next))} ${esc(F.time(c.next))}` : "—"}</td>
        <td><button class="btn ghost small" type="button" data-client="${esc(c.key)}">Randevu ver</button></td></tr>`;
    }).join("");
  }
  $("cl-q").addEventListener("input", renderClients);
  $("cl-rows").addEventListener("click", e => {
    const b = e.target.closest("[data-client]"); if (!b) return;
    const c = clients.find(x => x.key === b.dataset.client); if (c) { openNewBooking(null); fillClient(c); }
  });
  function fillClient(c) {
    $("nb-client").value = `${c.name} · ${c.phone}`;
    $("nb-name").value = c.name; $("nb-phone").value = c.phone; $("nb-email").value = c.email || "";
    nbPreview();
  }
  $("nb-client").addEventListener("input", () => {
    const v = $("nb-client").value, c = clients.find(x => `${x.name} · ${x.phone}` === v);
    if (c) fillClient(c);
  });

  /* ---------- Randevu ekle (elle) ---------- */
  const nbIds = ["nb-date", "nb-time", "nb-len", "nb-type", "nb-email", "nb-repeat", "nb-notify"];
  function nbStart() { const d = $("nb-date").value, t = $("nb-time").value; return d && t ? new Date(`${d}T${t}:00+03:00`) : null; }
  function nbPreview() {
    const st = nbStart(), weeks = +$("nb-repeat").value, mail = $("nb-email").value.trim();
    $("nb-notify").disabled = !mail;
    if (!st || isNaN(st)) { $("nb-preview").textContent = "Tarih ve saat seçin."; return; }
    const len = +$("nb-len").value || 50, en = new Date(st.getTime() + len * 60000);
    let txt = `${F.dateLong(st.toISOString())}, ${F.time(st.toISOString())}–${F.time(en.toISOString())} · ${$("nb-type").value === "online" ? "Online" : "Yüz yüze"}`;
    if (weeks > 1) { const last = new Date(st.getTime() + (weeks - 1) * 7 * 86400000); txt += ` · ${weeks} hafta boyunca her hafta (son seans ${F.dateShort(last.toISOString())})`; }
    if (en <= new Date()) txt += " · Geçmiş bir tarih: seans 'Tamamlandı' olarak kaydedilir, e-posta gitmez.";
    else txt += mail && $("nb-notify").checked ? " · Danışana onay e-postası gidecek." : " · Danışana e-posta gitmeyecek.";
    $("nb-preview").textContent = txt;
  }
  nbIds.forEach(id => $(id).addEventListener("input", nbPreview));
  // Yeni randevu penceresi: slot (boş saat) ya da pre {date, time, minutes, type} ile önceden doldurulur
  function openNewBooking(slot, pre) {
    $("nb-form").reset(); note($("nb-msg"), "");
    $("nb-date").value = F.todayKey(); $("nb-time").value = "10:00"; $("nb-len").value = 50;
    if (slot) {
      $("nb-date").value = F.dayKey(slot.starts_at); $("nb-time").value = F.time(slot.starts_at);
      $("nb-len").value = Math.round((new Date(slot.ends_at) - new Date(slot.starts_at)) / 60000) || 50;
      if (slot.type !== "ikisi") $("nb-type").value = slot.type;
    }
    if (pre) {
      if (pre.date) $("nb-date").value = pre.date;
      if (pre.time) $("nb-time").value = pre.time;
      if (pre.minutes) $("nb-len").value = pre.minutes;
      if (pre.type) $("nb-type").value = pre.type;
    }
    if (!$("nb-dialog").open) $("nb-dialog").showModal();
    nbPreview(); ((slot || pre) ? $("nb-client") : $("nb-date")).focus();
  }
  // Pencereleri kapat: ✕ / Vazgeç / arka plana tıklama
  document.querySelectorAll("dialog.modal").forEach(d => d.addEventListener("click", e => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  }));
  const NB_ERR = {
    name_required: "Danışanın adını yazın.", phone_required: "Geçerli bir telefon numarası yazın.", email_invalid: "E-posta adresi geçersiz.",
    duration_invalid: "Süre 15–240 dakika arasında olmalı.", type_required: "Seans türünü seçin.", not_admin: "Yönetici yetkisi doğrulanamadı; çıkış yapıp tekrar girin.",
  };
  $("nb-form").addEventListener("submit", async e => {
    e.preventDefault(); note($("nb-msg"), "");
    const st = nbStart(); if (!st || isNaN(st)) return note($("nb-msg"), "Tarih ve saat seçin.");
    const f = { starts: st.toISOString(), minutes: +$("nb-len").value, type: $("nb-type").value, name: $("nb-name").value.trim(),
      phone: $("nb-phone").value.trim(), email: $("nb-email").value.trim(), note: $("nb-note").value.trim(),
      weeks: +$("nb-repeat").value, notify: $("nb-notify").checked };
    if (f.name.length < 2) return note($("nb-msg"), NB_ERR.name_required);
    if (f.phone.replace(/\D/g, "").length < 7) return note($("nb-msg"), NB_ERR.phone_required);
    const btn = $("nb-submit"); btn.disabled = true;
    try {
      const n = await Data.adminCreateBooking(f);
      wkGoTo(F.dayKey(f.starts));
      await refresh();
      $("nb-dialog").close();
      flash(`${esc(f.name)} için ${n > 1 ? `${n} seans` : "randevu"} eklendi.${f.email && f.notify && st > new Date() ? " Danışana onay e-postası gönderiliyor." : ""}`);
    } catch (err) {
      const m = String(err && err.message || "");
      const code = m.split(":")[0].trim(), at = m.includes(":") ? m.slice(m.indexOf(":") + 1).trim() : "";
      note($("nb-msg"), code === "slot_taken" ? `${at} saatinde zaten bir randevu var.`
        : code === "overlap" ? `${at} saati başka bir seansla çakışıyor. Takvimden kontrol edin.`
        : m === "demo" ? "Demo modunda elle randevu eklenemez."
        : NB_ERR[code] || "Randevu eklenemedi. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally { btn.disabled = false; }
  });

  /* ---------- Sekmeler ---------- */
  const tabs = [["t-bookings", "p-bookings"], ["t-clients", "p-clients"], ["t-calendar", "p-calendar"], ["t-add", "p-add"], ["t-tests", "p-tests"]];
  function selectTab(t) { tabs.forEach(([tt, pp]) => { const on = tt === t; $(tt).setAttribute("aria-selected", on); $(pp).hidden = !on; if (on && pp === "p-add") preview(); }); }
  tabs.forEach(([t]) => $(t).onclick = () => selectTab(t));
  if (!$("nb-date").value) $("nb-date").value = F.todayKey();
  setView(view);

  boot();
})();
