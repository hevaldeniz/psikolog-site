# pskhevaldenizozdemir.com — Proje Durumu (son güncelleme 23 Ekim 2026, 19:00)

## Yayın durumu
- Barındırma: GitHub Pages (ücretsiz). Depo: github.com/hevaldeniz/psikolog-site (public), dal `main`, kök klasör.
- Alan adı: www.pskhevaldenizozdemir.com (GoDaddy). Pages'te özel alan adı girildi.
- GoDaddy DNS: 4 A kaydı (@ → 185.199.108.153 / .109 / .110 / .111), CNAME www → hevaldeniz.github.io. Yönlendirme kapalı. Eski www → cloudfront kaydı değiştirildi.
- SSL: GitHub sertifikası bekleniyor. Çıkınca Settings → Pages → "Enforce HTTPS" işaretlenecek (20:44'te otomatik kontrol kuruldu).
- Bilgisayardaki yerel kopya: Belgeler\GitHub\psikolog-site (GitHub Desktop'ta açık).
- GitHub depoya CNAME dosyası ekledi: bir sonraki düzenlemeden önce GitHub Desktop'ta Fetch origin → Pull origin.

## Sitenin içeriği
- index.html: ana sayfa (hakkımda, çalışma alanları, online/yüz yüze, süreç, SSS, iletişim, sıradaki seanslar kartı)
- randevu.html: danışan gün/saat seçer; her slot Online veya Yüz yüze etiketli
- test.html: üyeliksiz ön değerlendirme (Ön Görüşme, PHQ-9, GAD-7, WHO-5); sonuç psikoloğa ve danışana e-postayla; PHQ-9 9. madde işaretlenirse 112 uyarısı + "DİKKAT" e-postası
- admin.html: yönetim paneli (randevular, takvim, toplu saat ekleme, testler)
- kvkk.html: KVKK aydınlatma metni (şablon — hukukçuya kontrol ettirilecek)
- Tema: varsayılan koyu, menüde açık (beyaz) tema düğmesi
- Renk paleti: #add7f6, #87bfff, #3f8efc, #2667ff, #3b28cc
- Ayarlar tek dosyada: assets/js/config.js (telefon, WhatsApp, e-posta, adres, Instagram, Supabase, Google Ads)

## 22 Ekim güncellemesi
- Enforce HTTPS açık; site https://www.pskhevaldenizozdemir.com adresinde yayında.
- Supabase projesi: psikolog-site (ref etqlcpukpiayywozxqmu, Avrupa). Tablolar kuruldu, dışarıdan üye olma kapalı. config.js'e URL + anon key eklendi ve push edildi.
- Edge Function submit-assessment kuruldu. Secrets: FROM_EMAIL=form@pskhevaldenizozdemir.com, PSYCHOLOGIST_EMAIL=pskdenizozdemir@gmail.com, SITE_URL, SEND_SCORES_TO_CLIENT=false.
- Resend: alan adı eklendi (bölge Tokyo), DKIM/SPF/DMARC kayıtları GoDaddy'ye girildi; doğrulama bekleniyor.
- Yönetici hesabı: pskdenizozdemir@gmail.com (admins tablosunda). RESEND_API_KEY eklendi, Resend alan adı doğrulandı.
- Uçtan uca test başarılı (22 Ekim): test formu kaydedildi, 2 e-posta teslim edildi; test randevusu alındı. Test kayıtları silindi.
- Online + Yüz yüze ortak saat ("ikisi") eklendi: danışan türü seçer, saat dolunca iki tür birden kapanır. Panelde 'Saat ekle' aynı saatlere farklı tür eklenince mevcut saati otomatik ortak saate çevirir; Takvim'de türe tıklamak Online → Yüz yüze → Online/Yüz yüze döngüsü yapar. DB migration: supabase/migration-ikisi.sql (uygulandı).
- Panel güvenliği (22 Ekim): giriş = şifre + Authenticator kodu (TOTP) zorunlu; veritabanında is_admin() aal2 şartı; 20 dk hareketsizlikte otomatik çıkış; admin.html'de CSP + no-referrer + noindex, Google Ads panelde yüklenmez; ziyaretçi (anon) rolünden randevu/test tablolarına tüm yetkiler kaldırıldı; dışarıdan üye olma kapalı; Supabase Site URL = canlı site, yönlendirme listesi boş. Security Advisor: 0 hata; uyarılar bilinçli (book_slot herkese açık olmalı, is_admin politika için gerekli), sızdırılmış şifre koruması ücretli planda. migration-guvenlik.sql uygulandı.
- Randevu e-postaları (22 Ekim): bookings INSERT → trigger randevu_bildirimi (supabase_functions.http_request) → Edge Function notify-booking. Danışana onay + psikoloğa "Yeni randevu" e-postası, ikisinde de .ics takvim dosyası; her randevu için tek gönderim (notified_at). Randevu formunda e-posta zorunlu. İsteğe bağlı secrets: OFFICE_ADDRESS, CONTACT_PHONE (girilmezse e-postada "ayrıca iletilecek" yazar). Test başarılı, test kaydı silindi.
- Randevu formu: ad soyad (en az 2 kelime), telefon (en az 10 hane), e-posta zorunlu; hem formda (* işaretli) hem book_slot fonksiyonunda sunucu tarafında kontrol ediliyor (migration-zorunlu-alanlar.sql uygulandı).
- Randevu formunda Ad ve Soyad ayrı kutucuklar (ikisi de zorunlu); veritabanına "Ad Soyad" olarak birleşik kaydedilir.
- Varsayılan tema açık (beyaz); koyu tema menüdeki düğmeyle. Panelde 'Tüm boş saatleri sil' düğmesi (dolu saatlere dokunmaz). CSS/JS dosyaları ?v= sürüm etiketiyle yüklenir; değişiklikte HTML'lerdeki v= değeri artırılmalı.
- HAKKIMDA.docx bilgileri işlendi (22 Ekim): telefon/WhatsApp 0532 159 57 26, e-posta pskdenizozdemir@gmail.com, adres Caddebostan Mah. Ethem Efendi Cad. Çapçı Apt. No:14 D:12 Kadıköy/İstanbul (+ harita bağlantısı), LinkedIn, Instagram; eğitim (İstanbul Okan Üni. Psikoloji 2021, İstanbul Aydın Üni. Klinik Psikoloji YL 2023), BDT + Şema Terapi, 2022'den beri meslekte, 2025'ten beri kendi kliniği. SSS maddesi ve Google yapılandırılmış verisi eklendi. E-posta fonksiyonuna OFFICE_ADDRESS ve CONTACT_PHONE girildi.
- Hakkımda metni (23 Ekim) daha resmî ve profesyonel bir dille yeniden yazıldı; başlık "Klinik Psikolog Heval Deniz Özdemir"; "Y. Lisans" → "Yüksek Lisans", üniversite adı "İstanbul Okan Üniversitesi".
- Randevu iptali (23 Ekim): danışanın onay e-postasında kırmızı "Randevumu iptal et" butonu → iptal.html?t=<kişiye özel anahtar>. Seansa 24 saatten fazla varsa danışan online iptal eder, saat yeniden açılır; 24 saatten az kaldıysa sayfa telefon/WhatsApp'a yönlendirir. Her iptalde (danışan ya da panelden psikolog) iki e-posta: danışana "Randevunuz iptal edildi", psikoloğa "Randevu iptal edildi: …" (iptal edeni yazar), takvimden silmek için iptal .ics eki. Tek gönderim: cancel_notified_at. Trigger randevu_iptal_bildirimi (UPDATE status→iptal) → notify-booking. Panelde durum "İptal · danışan/siz". migration-iptal.sql uygulandı, uçtan uca test başarılı, test kayıtları silindi.
- İptal süresi ve hatırlatmalar (23 Ekim): kural 24 saat; iptal butonu seanstan 12 saat öncesine kadar çalışır, 12–24 saat arası iptaller "geç iptal" (late_cancel) olarak kaydedilir; psikoloğa "Geç iptal: …" konulu e-posta, panelde "İptal · danışan · geç". Danışana seanstan 3 gün önce (randevu en az 3 gün önce alındıysa) ve 1 gün önce (randevu en az 1 gün önce alındıysa) iptal butonlu hatırlatma e-postası. pg_cron görevi randevu-hatirlatma her saat :07'de notify-booking'i {type:REMINDERS} ile çağırır; claim_reminders() tek gönderimi garanti eder (reminder3_sent_at / reminder1_sent_at). migration-hatirlatma.sql uygulandı, test başarılı, test kayıtları silindi.
- Ana sayfa kartı (23 Ekim): "Sıradaki uygun seanslar" listesi yerine "Uygun günler" mini takvimi (assets/js/home.js). Boş saati olan günler işaretli, gün seçince saatler açılır; saate tıklayınca randevu.html?slot=… o saat seçili açılır (?d=YYYY-MM-DD gün seçili açar). Tür işaretleri: daire = online, kare = yüz yüze, ikisi yan yana = ikisi de.
- Testler (23 Ekim): menüde "Ön değerlendirme" → "Testler". Yeni ölçekler: K10 (Kessler psikolojik sıkıntı), ASRS v1.1 (yetişkin DEHB tarama, ≥4 işaretli eşik), DOCS (Boyutsal OKB Ölçeği, resmî Türkçe çeviri, 4 alt ölçek), Beş Faktör Kişilik (IPIP-50, kamuya açık). Beck Depresyon/Anksiyete ve SCL-90 (Pearson), Young Şema Ölçeği (Schema Therapy Institute) ve MBTI telifli olduğu için izinsiz eklenmedi. forms.json yeni yapı: maddeye özel seçenekler, bölüm başlıkları, ters puanlanan maddeler, alt ölçekler, tarama eşikleri; submit-assessment fonksiyonu güncellendi. Uçtan uca test başarılı, test kayıtları silindi.
- Sayfa ayrımı (23 Ekim, 15:00): "Ön değerlendirme" (test.html, başlık "Seanstan önce birkaç dakikanızı ayırın") → Ön Görüşme Formu, GAD-7, K10. "Testler" (testler.html, ayrı menü sekmesi) → PHQ-9, ASRS, DOCS, Beş Faktör. WHO-5 sitede gösterilmiyor (forms.json'da hidden; eski kayıtlar panelde görünür). forms.json'da her formun "group" alanı var (on / test). Eski test.html?form=phq9 gibi bağlantılar doğru sayfaya yönlenir. Menü 1180 px altında "Menü" düğmesine dönüşür.
- Psikoloğa giden test e-postasında "Sonuçların yorumu" bölümü (kesme noktaları, bu sonucun anlamı, öne çıkan yanıtlar, alt ölçek yorumları; forms.json → interpret, bands[].desc). Danışan e-postası değişmedi. submit-assessment forms.json'u dakikalık önbellek kırıcıyla okur.
- Ana sayfa (23 Ekim): Instagram bölümü (tek profil penceresi + takip et butonu), iletişimde Google Haritalar ("Klinik Psikolog Heval Deniz Özdemir" işletme kaydı), tıklanabilir e-posta/telefon, başlık "Size nasıl yardımcı olabilirim?". Çalışma alanları 12 başlık (Kaygı, Stres, Obsesyonlar, Duygudurum bozuklukları, Öfke problemleri, İlişkiler, Tekrarlayıcı döngüler, Kişilik bozuklukları, Travmatik deneyimler, Yas ve kayıp, Zorlayıcı yaşantılar, Kendini tanıma).
- 23 Ekim, 18:00: Ön değerlendirme = Ön Görüşme Formu, GAD-7, K10, WHO-5 (ana sayfada randevu takviminin altında, Hakkımda'nın üstünde kart olarak da var; ayrıca test.html). Testler = ASRS, DOCS, Beş Faktör. PHQ-9 sitede gizli (hidden; eski kayıtlar panelde görünür). Tüm sayfalarda üst menü aynı: Hakkımda, Çalışma alanları, Online / Yüz yüze, Ön değerlendirme, Testler, SSS, İletişim.
- 23 Ekim, 18:15: PHQ-9 Testler sayfasına geri eklendi. Duygusal Zekâ Testi (kullanıcının gönderdiği 30 maddelik Türkçe form; Hall'un anketi) Testler'e eklendi: 1–6 Likert, 5 alt boyut (farkındalık 1,2,4,17,19,25; duyguları yönetme 3,7,8,10,18,30; motivasyon 5,6,13,14,16,22; empati 9,11,20,21,23,28; ilişkiler 12,15,24,26,27,29), alt boyut 6–36; ≥35 yüksek, 18–34 orta, ≤17 düşük. Beck Depresyon/Anksiyete: kullanıcı formları gönderdi ancak yazılı izin/lisans olmadığı için eklenmedi (telif); izin gelirse puanlama belgesi hazır (BDE 10–16 hafif, 17–29 orta, 30–63 şiddetli; BAE 8–15 hafif, 16–25 orta, 26–63 şiddetli).
- 23 Ekim, 19:00: Testler'e eklenenler (kamuya açık/ücretsiz ölçekler): PCL-5 (travma sonrası stres, 0–80, küme puanları), Sosyal Kaygı (APA şiddet ölçeği), DERS-16 (duygu düzenleme güçlüğü, 5 alt ölçek), Rosenberg Benlik Saygısı, ayrıca PHQ-9, ASRS, DOCS, Beş Faktör, Duygusal Zekâ.
- 23 Ekim, 19:00: Testler'e üç yeni test: Jung Kişilik Tipleri (OEJTS, 32 karşıt ifade çifti, dört harfli tip; CC BY-NC-SA lisanslı, MBTI değildir), Mizah Tarzları Ölçeği (Martin ve ark. 2003, 32 madde, 4 tarz, 8–56; düzeyler kaba sınıflama), Karakter Güçlü Yönleri (IPIP-VIA, kamuya açık, 24 güçlü yön × 4 madde = 96 madde; en belirgin 5 ve en az kullanılan 3 yön yorumda). Psikoloğa giden e-postada tip açıklaması / sıralama. Site push edildi; submit-assessment fonksiyonunun Supabase'de yeniden yayınlanması gerekiyor (oturum kapanmıştı).
- İzin başvuruları: Beck Depresyon/Anksiyete ve SCL-90-R için Pearson formları gönderildi. ECR-R (R. Chris Fraley, rcfraley@uiuc.edu) ve PROMIS Öfke (HealthMeasures HEAP, help@HealthMeasures.net) için İngilizce izin e-postaları hazırlandı; gönderim kullanıcıda. ECR-R Türkçe uyarlaması için Selçuk ve ark. (2005) yazarlarından da izin istenmesi önerilir.
- Sıradaki: panelden gerçek seans saatlerini açmak; config.js'e telefon/WhatsApp/adres; hakkımda/eğitim/fotoğraf; Google Ads.

## Eksikler / sıradaki adımlar
1. SSL çıkınca Enforce HTTPS'i aç, siteyi kontrol et.
2. Supabase (ücretsiz): proje aç (Frankfurt), supabase/schema.sql çalıştır, yönetici kullanıcı ekle, admins tablosuna ekle, URL + anon key → config.js. Kayıt (sign-up) kapatılacak.
3. Resend (ücretsiz): alan adını doğrula (GoDaddy'ye TXT/MX kayıtları), API anahtarı al.
4. Supabase Edge Function `submit-assessment` deploy + secrets: RESEND_API_KEY, FROM_EMAIL, PSYCHOLOGIST_EMAIL, SITE_URL, SEND_SCORES_TO_CLIENT.
5. config.js içine gerçek telefon, WhatsApp, e-posta, ofis adresi; index.html'e hakkımda/eğitim bilgileri ve fotoğraf (assets/img/portre.jpg).
6. Google Ads: dönüşüm etiketi (AW-...) ve dönüşüm etiketleri config.js'e.
7. Ölçek ifadelerini Türkçe geçerlik-güvenirliği yapılmış resmi formlarla değiştir.

## Düzenleme akışı
VS Code'da dosyayı düzenle → kaydet → GitHub Desktop'ta özet yaz → Commit to main → Push origin. Site 1–2 dk içinde güncellenir.

## Hesaplar ve kaynaklar (şifre içermez)
- GitHub: hevaldeniz/psikolog-site (public, GitHub Pages, main / root)
- Alan adı: GoDaddy — pskhevaldenizozdemir.com
- Supabase: proje psikolog-site (ref etqlcpukpiayywozxqmu, Avrupa); Edge Functions: submit-assessment, notify-booking; triggerlar: randevu_bildirimi, randevu_iptal_bildirimi; zamanlanmış görev (pg_cron): randevu-hatirlatma
- Resend: alan adı pskhevaldenizozdemir.com doğrulandı; gönderen form@pskhevaldenizozdemir.com
- Sonuç/bildirim adresi ve panel yönetici hesabı: pskdenizozdemir@gmail.com (panel girişi şifre + Authenticator kodu)
- Bilgisayardaki kopya: Belgeler\GitHub\psikolog-site (GitHub Desktop)

## Veritabanı değişiklik dosyaları (supabase/ klasörü, hepsi uygulandı)
schema.sql (güncel tam şema), migration-ikisi.sql, migration-guvenlik.sql, migration-bildirim.sql, migration-zorunlu-alanlar.sql, migration-iptal.sql, migration-hatirlatma.sql
