/* Ortak: menü, iletişim bilgileri, çerez onayı + Google Ads (Consent Mode v2), demo uyarısı */
(function () {
  const C = window.SITE_CONFIG;

  // İletişim alanlarını config'ten doldur
  document.querySelectorAll("[data-c]").forEach(el => {
    const k = el.getAttribute("data-c"); if (C[k]) el.textContent = C[k];
  });
  document.querySelectorAll("[data-href]").forEach(el => {
    const k = el.getAttribute("data-href");
    if (k === "whatsapp") el.href = `https://wa.me/${C.whatsapp}`;
    if (k === "phone") el.href = `tel:${C.phone.replace(/\s/g, "")}`;
    if (k === "email") el.href = `mailto:${C.email}`;
    if (k === "maps") el.href = C.mapsUrl;
    if (k === "instagram") el.href = `https://instagram.com/${C.instagram}`;
    if (k === "linkedin") el.href = C.linkedin;
  });
  document.querySelectorAll("[data-year]").forEach(el => el.textContent = new Date().getFullYear());

  // Tema (varsayılan açık, seçim tarayıcıda hatırlanır)
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const root = document.documentElement;
  function paintThemeBtns() {
    const light = root.getAttribute("data-theme") !== "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(b => {
      b.innerHTML = light ? `${MOON}<span>Koyu tema</span>` : `${SUN}<span>Açık tema</span>`;
      b.setAttribute("aria-label", light ? "Koyu temaya geç" : "Açık temaya geç");
    });
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(b => b.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    try { localStorage.setItem("psk_theme", next); } catch (e) {}
    paintThemeBtns();
  }));
  paintThemeBtns();

  // Mobil menü
  const toggle = document.querySelector(".nav-toggle"), links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => { const o = links.classList.toggle("open"); toggle.setAttribute("aria-expanded", o); });
    links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => links.classList.remove("open")));
  }

  // Demo modu uyarısı
  if (window.Data && window.Data.mode === "demo") {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.textContent = "Demo modu: randevular yalnızca bu tarayıcıda saklanıyor. Canlıya almak için config.js içine Supabase bilgilerini girin.";
    document.body.prepend(bar);
  }

  /* ---------- Google Ads + çerez onayı ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });

  const isAdmin = /admin\.html$/.test(location.pathname);
  if (C.googleAdsId && !isAdmin) {
    const s = document.createElement("script");
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${C.googleAdsId}`;
    document.head.appendChild(s);
    gtag("js", new Date()); gtag("config", C.googleAdsId);
  }

  let consent = null;
  try { consent = localStorage.getItem("psk_consent"); } catch (e) {}
  function applyConsent(v) {
    const g = v === "all" ? "granted" : "denied";
    gtag("consent", "update", { ad_storage: g, ad_user_data: g, ad_personalization: g, analytics_storage: g });
  }
  if (consent) applyConsent(consent);
  else if (C.googleAdsId && !isAdmin) {
    const bar = document.createElement("div");
    bar.className = "cookie";
    bar.innerHTML = `<div class="wrap"><p>Sitemizde, reklamlarımızın etkisini ölçmek için çerezler kullanıyoruz. Detaylar <a href="kvkk.html">KVKK ve Çerez Aydınlatma Metni</a>'nde.</p>
      <div><button class="btn ghost small" id="ck-no" type="button">Yalnızca gerekli</button><button class="btn small" id="ck-yes" type="button">Kabul et</button></div></div>`;
    document.body.appendChild(bar);
    const done = v => { try { localStorage.setItem("psk_consent", v); } catch (e) {} applyConsent(v); bar.remove(); };
    bar.querySelector("#ck-yes").onclick = () => done("all");
    bar.querySelector("#ck-no").onclick = () => done("necessary");
  }

  // Dönüşüm takibi
  window.trackConversion = function (kind) {
    const label = C.conversions && C.conversions[kind];
    if (C.googleAdsId && label) gtag("event", "conversion", { send_to: `${C.googleAdsId}/${label}` });
  };
  document.querySelectorAll("[data-track]").forEach(el => el.addEventListener("click", () => window.trackConversion(el.getAttribute("data-track"))));
})();
