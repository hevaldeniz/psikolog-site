/* Ana sayfa: "Uygun günler" mini takvimi. Boş saati olan günler işaretli; gün seçince saatler açılır.
   Saate tıklamak randevu sayfasını o saat seçili olarak açar (randevu.html?slot=...). */
(function () {
  const F = Data.fmt;
  const $ = id => document.getElementById(id);
  const monthFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", month: "long", year: "numeric" });
  const longFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

  let byDay = new Map(), today = F.todayKey(), view = null, sel = null, first = null, last = null;

  const keyDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dateKey = d => d.toISOString().slice(0, 10);
  const monthOf = k => k.slice(0, 7);
  const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return dateKey(d).slice(0, 7); };

  function renderMonth() {
    const [y, m] = view.split("-").map(Number);
    $("cal-month").textContent = monthFmt.format(new Date(Date.UTC(y, m - 1, 1)));
    $("cal-prev").disabled = view <= monthOf(today);
    $("cal-next").disabled = !last || view >= monthOf(last);

    const grid = $("cal-grid"); grid.innerHTML = "";
    DOW.forEach(d => { const s = document.createElement("span"); s.className = "cal-dow"; s.textContent = d; s.setAttribute("aria-hidden", "true"); grid.appendChild(s); });
    // İçinde bulunduğumuz ayda geçmiş haftalar gösterilmez; takvim bu haftadan başlar
    let startDay = 1;
    if (view === monthOf(today)) { const t = keyDate(today); startDay = Math.max(1, t.getUTCDate() - (t.getUTCDay() + 6) % 7); }
    const start = new Date(Date.UTC(y, m - 1, startDay));
    const lead = (start.getUTCDay() + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(document.createElement("span"));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = startDay; d <= days; d++) {
      const k = dateKey(new Date(Date.UTC(y, m - 1, d)));
      const list = byDay.get(k);
      const b = document.createElement("button");
      b.type = "button"; b.className = "cal-day"; b.textContent = d;
      if (k === today) b.classList.add("today");
      if (list) {
        b.classList.add("has");
        b.setAttribute("aria-pressed", k === sel);
        b.setAttribute("aria-label", `${longFmt.format(keyDate(k))}, ${list.length} uygun saat`);
        b.onclick = () => { sel = k; renderMonth(); renderTimes(); };
      } else {
        b.disabled = true;
        b.setAttribute("aria-label", `${longFmt.format(keyDate(k))}, uygun saat yok`);
      }
      grid.appendChild(b);
    }
  }

  function renderTimes() {
    const list = byDay.get(sel) || [];
    $("cal-day-title").textContent = sel ? (sel === today ? "Bugün · " : "") + longFmt.format(keyDate(sel)) : "";
    const wrap = $("cal-times"); wrap.innerHTML = "";
    list.forEach(s => {
      const a = document.createElement("a");
      a.className = "time-chip"; a.href = `randevu.html?slot=${encodeURIComponent(s.id)}`;
      a.innerHTML = `<i class="mk ${F.typeClass(s.type)}" aria-hidden="true"></i><span></span>`;
      a.querySelector("span").textContent = F.time(s.starts_at);
      a.setAttribute("aria-label", `${F.time(s.starts_at)}, ${F.typeLabel(s.type)}`);
      wrap.appendChild(a);
    });
    $("cal-cta").href = sel ? `randevu.html?d=${sel}` : "randevu.html";
  }

  async function init() {
    let slots;
    try { slots = await Data.listAvailableSlots(); }
    catch (e) { $("cal-body").innerHTML = '<p class="muted small">Takvim şu an yüklenemedi. <a href="randevu.html">Randevu sayfasını</a> deneyin.</p>'; return; }
    slots.forEach(s => { const k = F.dayKey(s.starts_at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
    const keys = [...byDay.keys()].sort();
    if (!keys.length) {
      $("cal-body").innerHTML = '<p class="muted small">Şu an açık saat yok. <a data-href="whatsapp" href="#iletisim">WhatsApp\'tan yazabilirsiniz.</a></p>';
      return;
    }
    first = keys[0]; last = keys[keys.length - 1]; sel = first; view = monthOf(first);
    $("cal-prev").onclick = () => { view = shiftMonth(view, -1); renderMonth(); };
    $("cal-next").onclick = () => { view = shiftMonth(view, 1); renderMonth(); };
    renderMonth(); renderTimes();
  }

  init();

  // Instagram: tek profil penceresi (config.js → instagram)
  const C = window.SITE_CONFIG, ig = $("ig-grid");
  if (ig && C.instagram) {
    const frame = (src, title, cls) => {
      const f = document.createElement("figure"); f.className = `ig-frame ${cls || ""}`;
      const i = document.createElement("iframe");
      i.src = src; i.title = title; i.loading = "lazy"; i.setAttribute("allowtransparency", "true"); i.setAttribute("scrolling", "yes");
      f.appendChild(i); ig.appendChild(f);
    };
    const user = encodeURIComponent(C.instagram);
    frame(`https://www.instagram.com/${user}/embed/`, "Instagram profili", "ig-profile");
  }

  // Harita (config.js → mapsEmbedQuery ya da address)
  const map = $("map");
  if (map) map.src = `https://www.google.com/maps?q=${encodeURIComponent(C.mapsEmbedQuery || C.address)}&hl=tr&z=16&output=embed`;
})();
