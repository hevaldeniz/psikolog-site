/* Ön değerlendirme / test sayfası (üyeliksiz) */
(function () {
  const $ = id => document.getElementById(id);
  let forms = [], form = null;

  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function msg(text, kind) { const m = $("t-msg"); m.hidden = !text; m.className = `notice ${kind || "err"}`; m.textContent = text || ""; }

  // Hangi form? ?form=phq9 veya #phq9 — size özel link gönderebilirsiniz: alanadiniz.com/test.html?form=phq9
  function requestedId() {
    const q = new URLSearchParams(location.search).get("form");
    return q || (location.hash || "").replace("#", "") || null;
  }

  async function boot() {
    try { forms = await Data.loadForms(); }
    catch (e) { $("form-cards").innerHTML = '<div class="empty">Formlar yüklenemedi. Sayfayı yenileyin.</div>'; return; }
    renderList();
    const id = requestedId();
    if (id && forms.some(f => f.id === id)) open(id);
  }

  function renderList() {
    $("form-cards").innerHTML = forms.map(f => `
      <a class="form-card" href="test.html?form=${f.id}" data-id="${f.id}">
        <h3>${esc(f.title)}</h3>
        <p class="muted">${esc(f.short)}</p>
        <span class="meta"><span>Yaklaşık ${f.minutes} dk</span><span>${f.kind === "scale" ? f.items.length + " soru" : f.fields.length + " soru"}</span></span>
      </a>`).join("");
    $("form-cards").querySelectorAll("[data-id]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); open(a.dataset.id); }));
  }

  function open(id) {
    form = forms.find(f => f.id === id);
    $("list-view").hidden = true; $("done-view").hidden = true; $("form-view").hidden = false;
    $("f-eyebrow").textContent = `Yaklaşık ${form.minutes} dakika`;
    $("f-title").textContent = form.title;
    $("f-instr").textContent = form.instructions || form.short;
    $("t-submit").textContent = `${form.title} formunu gönder`;
    const q = $("questions");
    if (form.kind === "scale") {
      q.innerHTML = form.items.map((it, i) => `
        <fieldset class="q" data-q="${i}">
          <legend><span class="n">${i + 1}.</span><span>${esc(it)}</span></legend>
          <div class="opts">${form.options.map(o => `<label><input type="radio" name="q${i}" value="${o.value}">${esc(o.label)}</label>`).join("")}</div>
        </fieldset>`).join("");
      $("progress").hidden = false;
    } else {
      q.innerHTML = `<div class="card form">${form.fields.map(fl => {
        const req = fl.required ? "" : ' <span class="muted">(isteğe bağlı)</span>';
        const id = `fld-${fl.id}`;
        let input;
        if (fl.type === "textarea") input = `<textarea id="${id}" maxlength="1500"></textarea>`;
        else if (fl.type === "select") input = `<select id="${id}"><option value="">Seçin</option>${fl.options.map(o => `<option>${esc(o)}</option>`).join("")}</select>`;
        else input = `<input id="${id}" type="${fl.type === "number" ? "number" : "text"}" ${fl.type === "number" ? 'min="0" max="120" inputmode="numeric"' : 'maxlength="300"'}>`;
        return `<div class="field" data-f="${fl.id}"><label for="${id}">${esc(fl.label)}${req}</label>${input}</div>`;
      }).join("")}</div>`;
      $("progress").hidden = true;
    }
    progress();
    window.scrollTo({ top: 0 });
  }

  function answers() {
    if (form.kind === "scale") return form.items.map((_, i) => { const c = document.querySelector(`input[name="q${i}"]:checked`); return c ? +c.value : null; });
    const o = {}; form.fields.forEach(fl => o[fl.id] = ($(`fld-${fl.id}`).value || "").trim()); return o;
  }
  function progress() {
    if (!form || form.kind !== "scale") return;
    const a = answers(), n = a.filter(v => v !== null).length;
    $("p-text").textContent = `${n} / ${a.length} soru yanıtlandı`;
    $("p-bar").style.width = `${(n / a.length) * 100}%`;
  }
  $("questions").addEventListener("change", e => { progress(); const f = e.target.closest(".q"); if (f) f.classList.remove("missing"); });

  $("back-link").addEventListener("click", e => { e.preventDefault(); form = null; $("form-view").hidden = true; $("list-view").hidden = false; $("t-form").reset(); });

  $("t-form").addEventListener("submit", async e => {
    e.preventDefault(); msg("");
    const name = $("t-name").value.trim(), email = $("t-email").value.trim(), phone = $("t-phone").value.trim();
    if (name.length < 3) return msg("Lütfen adınızı ve soyadınızı yazın.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("Yanıtlarınızın kopyasını gönderebilmemiz için geçerli bir e-posta adresi yazın.");
    const a = answers();
    if (form.kind === "scale") {
      const miss = a.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
      document.querySelectorAll(".q").forEach(f => f.classList.toggle("missing", miss.includes(+f.dataset.q)));
      if (miss.length) { msg(`${miss.map(i => i + 1).join(", ")}. ${miss.length > 1 ? "sorular" : "soru"} boş kaldı.`); document.querySelector(`.q[data-q="${miss[0]}"]`).scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    } else {
      const missing = form.fields.filter(fl => fl.required && !a[fl.id]);
      if (missing.length) return msg(`Lütfen doldurun: ${missing.map(f => f.label).join(" · ")}`);
    }
    if (!$("t-consent").checked) return msg("Göndermek için açık rıza kutusunu işaretleyin.");

    const btn = $("t-submit"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Gönderiliyor…";
    try {
      const res = await Data.submitAssessment({ form_id: form.id, name, email, phone, answers: a, website: $("t-website").value });
      if (!res || res.ok === false) throw new Error(res && res.error);
      $("form-view").hidden = true; $("done-view").hidden = false;
      $("crisis").hidden = !res.flagged;
      $("d-title").textContent = `Teşekkürler, ${name.split(" ")[0]}.`;
      $("d-text").textContent = res.demo
        ? "Demo modu: form panelde görünür, ancak e-posta gönderilmedi. Canlıda yanıtlarınız psikoloğunuza ve " + email + " adresine iletilir."
        : `Yanıtlarınız psikoloğunuza iletildi ve bir kopyası ${email} adresine gönderildi. Birkaç dakika içinde gelmezse istenmeyen e-posta klasörünüze bakın.`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      msg((err && err.message === "rate_limited") ? "Kısa sürede çok fazla form gönderildi. Lütfen bir süre sonra tekrar deneyin." : "Form gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  boot();
})();
