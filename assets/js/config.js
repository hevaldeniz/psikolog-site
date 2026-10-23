/* =========================================================
   SİTE AYARLARI — yalnızca bu dosyayı düzenlemeniz yeterli
   ========================================================= */
window.SITE_CONFIG = {
  // Kimlik
  name: "Heval Deniz Özdemir",
  title: "Klinik Psikolog",

  // İletişim (kendi bilgilerinizle değiştirin)
  phone: "0532 159 57 26",
  whatsapp: "905321595726",           // başında + olmadan, boşluksuz
  email: "pskdenizozdemir@gmail.com",
  address: "Caddebostan Mah. Ethem Efendi Cad. Çapçı Apt. No:14 D:12, Kadıköy / İstanbul",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Klinik%20Psikolog%20Heval%20Deniz%20%C3%96zdemir",
  instagram: "pskhevaldenizozdemir",
  // Haritada gösterilecek konum (Google Haritalar'daki işletme adı ya da adres)
  mapsEmbedQuery: "Klinik Psikolog Heval Deniz Özdemir",
  linkedin: "https://tr.linkedin.com/in/heval-deniz-%C3%B6zdemir-a3a6351a3",

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
