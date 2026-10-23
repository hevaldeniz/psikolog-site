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
    renderStats(); renderBookings(); renderCalendar(); renderTests();
  }

  /* ---------- Testler ---------- */
  let forms = null;
  async function renderTests() {
    const box = $("tests");
    let list;
    try { forms = forms || await Data.loadForms(); list = await Data.listAssessments(); }
    catch (e) { box.innerHTML = '<div class="notice err">Test sonuçları yüklenemedi.</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="empty">Henüz doldurulmuş form yok. Danışanlarınız test.html sayfasından doldurdukça burada görünür.</div>'; return; }
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

  /* ---------- Randevular ---------- */
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
                 <button class="icon-btn" data-act="del" aria-label="Saati sil" title="Sil">✕</button>`}
          </span>`; }).join("")}</div></div>`).join("");
  }
  $("cal").addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const item = btn.closest("[data-id]"), id = item.dataset.id, s = slots.find(x => x.id === id);
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

  /* ---------- Sekmeler ---------- */
  const tabs = [["t-bookings", "p-bookings"], ["t-calendar", "p-calendar"], ["t-add", "p-add"], ["t-tests", "p-tests"]];
  tabs.forEach(([t]) => $(t).onclick = () => tabs.forEach(([tt, pp]) => { const on = tt === t; $(tt).setAttribute("aria-selected", on); $(pp).hidden = !on; if (on && pp === "p-add") preview(); }));

  boot();
})();
