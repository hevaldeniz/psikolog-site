/* Randevu yönetim sayfası (iptal.html?t=...): danışan gün/saat değiştirir ya da iptal eder.
   E-posta/SMS'teki bağlantılar: #degistir → değişiklik ekranı, #iptal → iptal onayı. */
(function () {
  const F = Data.fmt, C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("t") || "";
  const contact = `${C.phone} numaralı telefondan ya da WhatsApp'tan`;
  let booking = null, slots = [], pickedDay = null, picked = null, firstLoad = true;

  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function msg(text, kind) { const m = $("msg"); m.hidden = !text; m.className = `notice ${kind || "err"}`; m.textContent = text || ""; }
  function actions(html) { $("actions").innerHTML = html; }
  function showSummary(b) {
    const el = $("summary"); el.hidden = false;
    el.innerHTML = `<b></b><span></span><span class="pill ${F.typeClass(b.type)}" style="justify-self:start">${F.typeLabel(b.type)}</span>`;
    el.querySelector("b").textContent = `${F.dateLong(b.starts_at)} · ${F.time(b.starts_at)}–${F.time(b.ends_at)}`;
    el.querySelector("span").textContent = b.type === "online" ? "Online görüşme" : C.address;
  }

  async function load() {
    $("change").hidden = true; msg("");
    if (!/^[0-9a-f-]{36}$/i.test(token)) { $("title").textContent = "Bağlantı geçersiz"; $("text").textContent = `Lütfen e-postanızdaki ya da SMS'teki bağlantıyı yeniden açın veya ${contact} bize ulaşın.`; return; }
    let b;
    try { b = await Data.bookingByToken(token); } catch (e) { $("title").textContent = "Randevu yüklenemedi"; $("text").textContent = "Bağlantınızı kontrol edip sayfayı yenileyin."; return; }
    if (!b) { $("title").textContent = "Randevu bulunamadı"; $("text").textContent = `Bağlantı hatalı olabilir. ${contact} bize ulaşabilirsiniz.`; return; }
    booking = b; showSummary(b);
    const first = b.first_name ? `${b.first_name}, ` : "";
    if (b.status === "iptal") {
      $("title").textContent = "Bu randevu iptal edilmiş";
      $("text").textContent = "Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
      actions('<a class="btn" href="randevu.html">Yeni randevu al</a>');
    } else if (b.can_cancel) {
      $("title").textContent = "Randevunuzu yönetin";
      $("text").textContent = `${first}randevunuzun gününü ya da saatini değiştirebilir veya randevunuzu iptal edebilirsiniz. Yaptığınız değişiklik size ve psikoloğunuza bildirilir.`;
      if (b.is_late) msg("Seansınıza 24 saatten az kaldı. Bu aşamada yapılan iptaller geç iptal olarak kaydedilir.", "warn");
      actions('<button class="btn" type="button" id="do-change">Gün/saat değiştir</button><button class="btn danger" type="button" id="do-cancel">Randevumu iptal et</button>');
      $("do-change").onclick = openChange;
      $("do-cancel").onclick = askConfirm;
      if (firstLoad && location.hash === "#degistir") openChange();
      else if (firstLoad && location.hash === "#iptal") askConfirm();
    } else if (new Date(b.starts_at) > new Date()) {
      $("title").textContent = "Online değişiklik süresi doldu";
      $("text").textContent = `Seansınıza 12 saatten az kaldığı için randevunuz bu sayfadan değiştirilemiyor ya da iptal edilemiyor. Lütfen ${contact} bize ulaşın.`;
      actions(`<a class="btn" data-href="whatsapp" href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener">WhatsApp'tan yaz</a>`);
    } else {
      $("title").textContent = "Bu randevunun tarihi geçmiş";
      $("text").textContent = "Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
      actions('<a class="btn" href="randevu.html">Yeni randevu al</a>');
    }
    firstLoad = false;
  }

  /* ---------- Gün/saat değiştir ---------- */
  async function openChange() {
    msg(""); actions('<button class="btn ghost" type="button" id="back">Vazgeç</button>'); $("back").onclick = load;
    const box = $("change"); box.hidden = false; box.innerHTML = '<p class="muted small">Uygun saatler yükleniyor…</p>';
    try { slots = await Data.listAvailableSlots(); } catch (e) { box.innerHTML = '<p class="notice err">Uygun saatler yüklenemedi. Sayfayı yenileyin.</p>'; return; }
    if (!slots.length) { box.innerHTML = `<p class="notice warn">Şu an açık başka bir saat yok. Değişiklik için ${esc(contact)} bize ulaşabilirsiniz.</p>`; return; }
    pickedDay = F.dayKey(slots[0].starts_at); picked = null; renderChange();
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function renderChange() {
    const days = [...new Set(slots.map(s => F.dayKey(s.starts_at)))];
    const list = slots.filter(s => F.dayKey(s.starts_at) === pickedDay);
    const dayLabel = k => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${k}T12:00:00+03:00`));
    const needType = picked && picked.type === "ikisi";
    $("change").innerHTML = `
      <h2 style="font-size:1.15rem;margin:8px 0 0">Yeni gün ve saat seçin</h2>
      <div class="field"><label for="ch-day">Gün</label>
        <select id="ch-day">${days.map(k => `<option value="${k}" ${k === pickedDay ? "selected" : ""}>${esc(dayLabel(k))}</option>`).join("")}</select></div>
      <div class="times" role="group" aria-label="Saatler" style="display:flex;flex-wrap:wrap;gap:8px">
        ${list.map(s => `<button type="button" class="chip" data-slot="${s.id}" aria-pressed="${picked && picked.id === s.id}">${esc(F.time(s.starts_at))} · ${esc(F.typeLabel(s.type))}</button>`).join("")}
      </div>
      ${needType ? `<div class="field"><span style="font-size:.88rem;font-weight:600">Seans türü</span>
        <div class="filters"><label class="chip-radio"><input type="radio" name="ch-type" value="yuzyuze" ${booking.type !== "online" ? "checked" : ""}>Yüz yüze</label>
        <label class="chip-radio"><input type="radio" name="ch-type" value="online" ${booking.type === "online" ? "checked" : ""}>Online</label></div></div>` : ""}
      ${picked ? `<p class="notice info">Yeni randevunuz: <b>${esc(F.dateLong(picked.starts_at))}, ${esc(F.time(picked.starts_at))}</b></p>
        <div class="hero-actions"><button class="btn" type="button" id="ch-ok">Yeni saati onayla</button></div>` : '<p class="small muted">Bir saat seçin.</p>'}`;
    $("ch-day").onchange = e => { pickedDay = e.target.value; picked = null; renderChange(); };
    $("change").querySelectorAll("[data-slot]").forEach(b => b.onclick = () => { picked = slots.find(s => s.id === b.dataset.slot); renderChange(); });
    if (picked) $("ch-ok").onclick = confirmChange;
  }
  async function confirmChange(e) {
    const btn = e.target; btn.disabled = true; btn.textContent = "Kaydediliyor…";
    const t = document.querySelector('input[name="ch-type"]:checked');
    let r;
    try { r = await Data.rescheduleByToken(token, picked.id, t ? t.value : null); } catch (err) { msg("Değişiklik kaydedilemedi. Lütfen tekrar deneyin."); btn.disabled = false; btn.textContent = "Yeni saati onayla"; return; }
    if (r === "ok") {
      await load();
      $("title").textContent = "Randevunuz güncellendi";
      $("text").textContent = "Yeni randevu bilgileriniz size e-posta ve SMS ile gönderildi.";
      msg("Değişiklik kaydedildi.", "ok");
    } else if (r === "slot_unavailable") {
      msg("Bu saat az önce doldu. Lütfen başka bir saat seçin."); openChange();
    } else if (r === "too_late") { load(); }
    else { msg(`Değişiklik yapılamadı. Lütfen ${contact} bize ulaşın.`); load(); }
  }

  /* ---------- İptal ---------- */
  function askConfirm() {
    $("change").hidden = true;
    actions('<span class="confirm-inline" style="flex-wrap:wrap"><span class="small">Randevunuz iptal edilecek. Emin misiniz?</span><button class="btn danger small" type="button" id="yes">Evet, iptal et</button><button class="btn ghost small" type="button" id="no">Vazgeç</button></span>');
    $("no").onclick = load;
    $("yes").onclick = async e => {
      e.target.disabled = true; e.target.textContent = "İptal ediliyor…";
      let r;
      try { r = await Data.cancelByToken(token); } catch (err) { msg("İptal işlemi tamamlanamadı. Lütfen tekrar deneyin."); return load(); }
      if (r === "ok" || r === "already") {
        msg("");
        $("title").textContent = "Randevunuz iptal edildi";
        $("text").textContent = "İptal bilgisi size gönderildi. Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
        actions('<a class="btn" href="randevu.html">Yeni randevu al</a><a class="btn ghost" href="index.html">Ana sayfa</a>');
      } else if (r === "too_late") { load(); }
      else { msg(`İptal işlemi yapılamadı. Lütfen ${contact} bize ulaşın.`); load(); }
    };
  }

  load();
})();
