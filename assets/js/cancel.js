/* Randevu iptal sayfası: e-postadaki bağlantıyla (iptal.html?t=...) çalışır */
(function () {
  const F = Data.fmt, C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("t") || "";
  const contact = `${C.phone} numaralı telefondan ya da WhatsApp'tan`;

  function msg(text, kind) { const m = $("msg"); m.hidden = !text; m.className = `notice ${kind || "err"}`; m.textContent = text || ""; }
  function actions(html) { $("actions").innerHTML = html; }
  function showSummary(b) {
    const el = $("summary"); el.hidden = false;
    el.innerHTML = `<b></b><span></span><span class="pill ${F.typeClass(b.type)}" style="justify-self:start">${F.typeLabel(b.type)}</span>`;
    el.querySelector("b").textContent = `${F.dateLong(b.starts_at)} · ${F.time(b.starts_at)}–${F.time(b.ends_at)}`;
    el.querySelector("span").textContent = b.type === "online" ? "Online görüşme" : C.address;
  }

  async function load() {
    if (!/^[0-9a-f-]{36}$/i.test(token)) { $("title").textContent = "Bağlantı geçersiz"; $("text").textContent = `Lütfen e-postanızdaki bağlantıyı yeniden açın ya da ${contact} bize ulaşın.`; return; }
    let b;
    try { b = await Data.bookingByToken(token); } catch (e) { $("title").textContent = "Randevu yüklenemedi"; $("text").textContent = "Bağlantınızı kontrol edip sayfayı yenileyin."; return; }
    if (!b) { $("title").textContent = "Randevu bulunamadı"; $("text").textContent = `Bağlantı hatalı olabilir. ${contact} bize ulaşabilirsiniz.`; return; }
    showSummary(b);
    const first = b.first_name ? `${b.first_name}, ` : "";
    if (b.status === "iptal") {
      $("title").textContent = "Bu randevu iptal edilmiş";
      $("text").textContent = "Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
      actions('<a class="btn" href="randevu.html">Yeni randevu al</a>');
    } else if (b.can_cancel) {
      $("title").textContent = "Randevunuzu iptal etmek istiyor musunuz?";
      $("text").textContent = `${first}aşağıdaki butonla randevunuzu iptal edebilirsiniz. İptal onayı size ve psikoloğunuza e-postayla iletilecek; bu saat başka danışanlar için yeniden açılacak.`;
      if (b.is_late) msg("Seansınıza 24 saatten az kaldı. Bu iptal geç iptal olarak kaydedilecek.", "warn");
      actions('<button class="btn danger" type="button" id="do-cancel">Randevumu iptal et</button><a class="btn ghost" href="index.html">Vazgeç</a>');
      $("do-cancel").onclick = askConfirm;
    } else if (new Date(b.starts_at) > new Date()) {
      $("title").textContent = "Online iptal süresi doldu";
      $("text").textContent = `Seansınıza 12 saatten az kaldığı için randevunuz bu sayfadan iptal edilemiyor. Lütfen ${contact} bize ulaşın.`;
      actions(`<a class="btn" data-href="whatsapp" href="https://wa.me/${C.whatsapp}" target="_blank" rel="noopener">WhatsApp'tan yaz</a>`);
    } else {
      $("title").textContent = "Bu randevunun tarihi geçmiş";
      $("text").textContent = "Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
      actions('<a class="btn" href="randevu.html">Yeni randevu al</a>');
    }
  }

  function askConfirm() {
    actions('<span class="confirm-inline" style="flex-wrap:wrap"><span class="small">Randevunuz iptal edilecek. Emin misiniz?</span><button class="btn danger small" type="button" id="yes">Evet, iptal et</button><button class="btn ghost small" type="button" id="no">Vazgeç</button></span>');
    $("no").onclick = load;
    $("yes").onclick = async e => {
      e.target.disabled = true; e.target.textContent = "İptal ediliyor…";
      let r;
      try { r = await Data.cancelByToken(token); } catch (err) { msg("İptal işlemi tamamlanamadı. Lütfen tekrar deneyin."); return load(); }
      if (r === "ok" || r === "already") {
        msg("");
        $("title").textContent = "Randevunuz iptal edildi";
        $("text").textContent = "İptal onayı e-posta adresinize gönderildi. Yeni bir randevu almak isterseniz size uygun saati seçebilirsiniz.";
        actions('<a class="btn" href="randevu.html">Yeni randevu al</a><a class="btn ghost" href="index.html">Ana sayfa</a>');
      } else if (r === "too_late") { load(); }
      else { msg(`İptal işlemi yapılamadı. Lütfen ${contact} bize ulaşın.`); load(); }
    };
  }

  load();
})();
