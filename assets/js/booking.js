/* Randevu sayfası: gün ve saat seçimi, form gönderimi */
(function () {
  const F = Data.fmt;
  const $ = id => document.getElementById(id);
  let all = [], filter = "all", day = null, picked = null;

  async function load() {
    try { all = await Data.listAvailableSlots(); }
    catch (e) { $("slots").innerHTML = '<div class="empty">Takvim yüklenemedi. Sayfayı yenileyin veya WhatsApp\'tan yazın.</div>'; return; }
    render();
  }

  function visible() { return all.filter(s => F.fits(s.type, filter)); }
  // Seçilen saat için kesinleşen seans türü (ortak saatte danışanın seçimi)
  function chosenType() {
    if (!picked) return null;
    if (picked.type !== "ikisi") return picked.type;
    const c = document.querySelector('input[name="f-type"]:checked'); return c ? c.value : null;
  }

  function render() {
    const slots = visible();
    const byDay = new Map();
    slots.forEach(s => { const k = F.dayKey(s.starts_at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
    const keys = [...byDay.keys()];
    if (!keys.includes(day)) day = keys[0] || null;

    const days = $("days"); days.innerHTML = "";
    if (!keys.length) {
      $("day-title").textContent = "";
      $("slots").innerHTML = '<div class="empty">Bu seans türünde açık saat yok. Diğer türe bakabilir ya da WhatsApp\'tan yazabilirsiniz.</div>';
      return;
    }
    keys.forEach(k => {
      const first = byDay.get(k)[0].starts_at, b = document.createElement("button");
      b.type = "button"; b.className = "day"; b.setAttribute("aria-pressed", k === day);
      b.innerHTML = `<small>${F.weekdayShort(first)}</small><b>${F.dayNum(first)}</b><i>${F.monthShort(first)} · ${byDay.get(k).length}</i>`;
      b.setAttribute("aria-label", `${F.dateLong(first)}, ${byDay.get(k).length} açık saat`);
      b.onclick = () => { day = k; render(); };
      days.appendChild(b);
    });

    const list = byDay.get(day);
    $("day-title").textContent = F.dateLong(list[0].starts_at);
    const wrap = $("slots"); wrap.innerHTML = "";
    list.forEach(s => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "slot"; b.setAttribute("aria-pressed", picked && picked.id === s.id);
      b.innerHTML = `<b>${F.time(s.starts_at)}</b><span class="pill ${F.typeClass(s.type)}">${F.typeLabel(s.type)}</span>`;
      b.onclick = () => {
        picked = s;
        if (s.type === "ikisi") {
          document.querySelectorAll('input[name="f-type"]').forEach(r => r.checked = (filter !== "all" && r.value === filter));
        }
        render(); summary();
      };
      wrap.appendChild(b);
    });
  }

  function summary() {
    const el = $("summary");
    if (!picked) { el.innerHTML = '<span class="muted">Önce soldan bir saat seçin.</span>'; $("submit").disabled = true; return; }
    const t = chosenType() || picked.type;
    $("type-pick").hidden = picked.type !== "ikisi";
    el.innerHTML = `<b></b><span></span><span class="pill ${F.typeClass(t)}" style="justify-self:start">${F.typeLabel(t)}</span>`;
    el.querySelector("b").textContent = `${F.dateLong(picked.starts_at)} · ${F.time(picked.starts_at)}–${F.time(picked.ends_at)}`;
    el.querySelector("span").textContent = t === "online" ? "Görüntülü görüşme" : t === "yuzyuze" ? (window.SITE_CONFIG.address || "Ofiste") : "Aşağıdan seans türünü seçin";
    $("submit").disabled = false;
  }

  document.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", x === b));
    if (picked && !F.fits(picked.type, filter)) { picked = null; summary(); }
    else if (picked && picked.type === "ikisi" && filter !== "all") { document.querySelectorAll('input[name="f-type"]').forEach(r => r.checked = r.value === filter); summary(); }
    render();
  }));

  document.querySelectorAll('input[name="f-type"]').forEach(r => r.addEventListener("change", summary));

  function msg(text, kind) { const m = $("form-msg"); m.hidden = !text; m.className = `notice ${kind || "err"}`; m.textContent = text || ""; }

  $("book-form").addEventListener("submit", async ev => {
    ev.preventDefault(); msg("");
    if (!picked) return msg("Lütfen bir seans saati seçin.");
    const first = $("f-first").value.trim().replace(/\s+/g, " "), last = $("f-last").value.trim().replace(/\s+/g, " ");
    const name = `${first} ${last}`.trim(), phone = $("f-phone").value.trim(), email = $("f-email").value.trim(), note = $("f-note").value.trim();
    if (first.length < 2) { $("f-first").focus(); return msg("Lütfen adınızı yazın."); }
    if (last.length < 2) { $("f-last").focus(); return msg("Lütfen soyadınızı yazın."); }
    if (phone.replace(/\D/g, "").length < 10) return msg("Telefon numarası en az 10 haneli olmalı (örn. 05XX XXX XX XX).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("Randevu onayını gönderebilmemiz için geçerli bir e-posta adresi yazın.");
    const type = chosenType();
    if (!type) return msg("Lütfen seansın online mı yüz yüze mi olacağını seçin.");
    if (!$("f-kvkk").checked) return msg("Devam etmek için KVKK onay kutusunu işaretleyin.");

    const btn = $("submit"); btn.disabled = true; btn.textContent = "Kaydediliyor…";
    try {
      const r = await Data.book(picked.id, { name, phone, email, note, type });
      if (!r.ok) {
        msg("Bu saat az önce başka biri tarafından alındı. Lütfen başka bir saat seçin.");
        all = all.filter(s => s.id !== picked.id); picked = null; summary(); render();
        return;
      }
      window.trackConversion && window.trackConversion("booking");
      $("book-form").hidden = true; $("done").hidden = false;
      $("done-title").textContent = `${F.dateLong(picked.starts_at)}, ${F.time(picked.starts_at)}`;
      $("done-text").textContent = type === "online"
        ? `Online seansınız kaydedildi. Onay e-postası ${email} adresine gönderildi; görüşme bağlantısı seanstan önce iletilecek.`
        : `Yüz yüze seansınız kaydedildi. Onay e-postası ${email} adresine gönderildi. Adres: ${window.SITE_CONFIG.address}`;
      $("form-card").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      msg("Randevu kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin ya da WhatsApp'tan yazın.");
    } finally { btn.textContent = "Randevuyu oluştur"; btn.disabled = !picked; }
  });

  load();
})();
