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
  supabaseUrl: "https://etqlcpukpiayywozxqmu.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cWxjcHVrcGlheXl3b3p4cW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Njk0OTUsImV4cCI6MjEwODI0NTQ5NX0.uSLZYgvJIGHhW65YPci2yuRMeAZZ2Hed2NsVo3aHPMc",

  // Google Ads — README'deki "5. Google Ads" adımı
  googleAdsId: "",                    // örn. "AW-123456789"
  conversions: {
    booking: "",                      // randevu tamamlandı dönüşüm etiketi
    contact: ""                       // telefon / WhatsApp tıklaması dönüşüm etiketi
  },

  timeZone: "Europe/Istanbul"
};
