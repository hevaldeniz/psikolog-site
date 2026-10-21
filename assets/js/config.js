/* =========================================================
   SİTE AYARLARI — yalnızca bu dosyayı düzenlemeniz yeterli
   ========================================================= */
window.SITE_CONFIG = {
  // Kimlik
  name: "Heval Deniz Özdemir",
  title: "Klinik Psikolog",

  // İletişim (kendi bilgilerinizle değiştirin)
  phone: "+90 5XX XXX XX XX",
  whatsapp: "905XXXXXXXXX",          // başında + olmadan, boşluksuz
  email: "iletisim@alanadiniz.com",
  address: "Ofis adresinizi buraya yazın, İstanbul",
  mapsUrl: "https://maps.google.com/?q=Istanbul",
  instagram: "pskhevaldenizozdemir",

  // Seans bilgisi (sitede gösterilir)
  sessionMinutes: 50,

  // Supabase — README'deki "2. Supabase" adımından alın.
  // İkisi de boşsa site DEMO modunda çalışır (veriler yalnızca tarayıcıda tutulur).
  supabaseUrl: "",
  supabaseAnonKey: "",

  // Google Ads — README'deki "5. Google Ads" adımı
  googleAdsId: "",                    // örn. "AW-123456789"
  conversions: {
    booking: "",                      // randevu tamamlandı dönüşüm etiketi
    contact: ""                       // telefon / WhatsApp tıklaması dönüşüm etiketi
  },

  timeZone: "Europe/Istanbul"
};
