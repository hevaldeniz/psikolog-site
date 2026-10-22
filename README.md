# Psk. Heval Deniz Özdemir — Web Sitesi

Danışanların online veya yüz yüze seans saatini kendisinin seçtiği, sizin yönetici panelinden saat açıp randevuları yönettiğiniz statik bir site.

| Sayfa | Ne işe yarar |
|---|---|
| `index.html` | Ana sayfa: hakkımda, çalışma alanları, seans türleri, SSS, iletişim, canlı "sıradaki seanslar" kartı |
| `randevu.html` | Danışan günü → saati seçer (her saat Online / Yüz yüze etiketli), bilgilerini bırakır |
| `admin.html` | Sizin paneliniz: randevular, takvim, toplu saat ekleme (`alanadiniz.com/admin.html`) |
| `kvkk.html` | KVKK ve çerez aydınlatma metni (şablon; hukukçuya kontrol ettirin) |

Altyapı: **GitHub Pages** (ücretsiz barındırma) + **Supabase** (ücretsiz veritabanı ve giriş) + **GoDaddy** alan adınız.

Supabase bilgileri girilmeden site **demo modunda** çalışır: örnek saatler görünür, randevular yalnızca o tarayıcıda tutulur. Böylece her şeyi önce kendi bilgisayarınızda deneyebilirsiniz.

---

## 1. Bilgisayarınızda açın

1. Klasörü VS Code ile açın.
2. VS Code'a **Live Server** eklentisini kurun, `index.html` üzerinde sağ tık → *Open with Live Server*.
3. `admin.html`'e gidin; demo modunda herhangi bir e-posta/şifreyle girip saat ekleyip silmeyi deneyin.

Metinleri düzenlemek için:
- İletişim bilgileri, WhatsApp, adres, Instagram: **`assets/js/config.js`** (tek yer).
- Hakkımda, eğitimler, çalışma alanları, SSS: `index.html` içinde doğrudan.
- Fotoğraf: `assets/img/portre.jpg` olarak ekleyin ve `index.html`'deki `.portrait` bloğunu `<img src="assets/img/portre.jpg" alt="Psk. Heval Deniz Özdemir">` ile değiştirin.

## 2. Supabase (randevuların gerçekten kaydedilmesi)

1. https://supabase.com → ücretsiz hesap → **New project** (bölge olarak *Frankfurt (eu-central-1)* seçin).
2. Sol menü **SQL Editor** → `supabase/schema.sql` dosyasının tamamını yapıştırın → **Run**.
3. **Authentication → Users → Add user**: kendi e-postanız ve güçlü bir şifre ("Auto confirm" işaretli).
4. **Authentication → Sign In / Providers**: *Allow new users to sign up* seçeneğini **kapatın** (panele kimse kendi kendine üye olamasın).
5. SQL Editor'da, e-postayı kendi adresinizle değiştirip çalıştırın:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'sizin@epostaniz.com';
   ```
6. **Project Settings → API**: *Project URL* ve *anon public* anahtarını `assets/js/config.js` içinde `supabaseUrl` ve `supabaseAnonKey` alanlarına yapıştırın.
   (anon anahtarı herkese açık olacak şekilde tasarlanmıştır; danışan verileri satır düzeyi güvenlikle yalnızca size açıktır. `service_role` anahtarını **asla** bu dosyaya koymayın.)

Yeni randevu gelince e-posta bildirimi almak isterseniz: Supabase → **Database → Webhooks** ile `bookings` tablosuna ekleme olduğunda bir e-posta servisine (ör. Resend, Zapier) istek gönderebilirsiniz. Bunu sonraki adımda birlikte kurabiliriz.

## 3. GitHub'a yükleyin ve yayına alın

1. GitHub'da yeni bir depo açın (ör. `psikolog-site`). Public olmalı (GitHub Pages'in ücretsiz planı için).
2. VS Code → *Source Control* → **Publish to GitHub** ya da terminalde:
   ```bash
   git init && git add . && git commit -m "İlk sürüm"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADINIZ/psikolog-site.git
   git push -u origin main
   ```
3. Depo → **Settings → Pages** → *Source: Deploy from a branch* → `main` / `(root)` → Save.
4. Aynı sayfada **Custom domain** alanına `www.alanadiniz.com` yazıp kaydedin, DNS doğrulandıktan sonra **Enforce HTTPS**'i işaretleyin.

## 4. GoDaddy alan adını bağlayın

GoDaddy → **Alan Adlarım → DNS'i Yönet**:

| Tür | Ad | Değer |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `KULLANICI_ADINIZ.github.io` |

- Mevcut `@` A kaydını (GoDaddy "Parked") silin; *Domain Forwarding* açıksa kapatın.
- DNS yayılması birkaç dakika ile birkaç saat sürebilir.

## 5. Google Ads

Site Google Ads'i **yönetmez**; kampanyalarınızı ads.google.com üzerinden yönetirsiniz. Site, reklamlarınızın kaç randevuya dönüştüğünü ölçer:

1. Google Ads → **Hedefler → Dönüşümler → Yeni dönüşüm → Web sitesi** → "Google etiketini manuel kur".
2. İki dönüşüm oluşturun: **Randevu tamamlandı** ve **İletişim tıklaması**.
3. Etiket kimliğini (`AW-...`) ve her dönüşümün **etiketini** (`AW-.../` sonrası kısım) `config.js` içine yazın:
   ```js
   googleAdsId: "AW-123456789",
   conversions: { booking: "AbCdEf123", contact: "GhIjKl456" }
   ```
4. Ziyaretçiye çerez onay çubuğu otomatik çıkar (Google Consent Mode v2). Onay vermeyen ziyaretçide reklam çerezi yazılmaz.

Not: Google'ın sağlık alanındaki reklam politikaları ve Türkiye'deki sağlık hizmeti tanıtımı kuralları reklam metinlerinizi sınırlayabilir (garanti, "en iyi", fiyat vaadi gibi ifadeler). Reklam metinlerini bu açıdan kontrol edin.

## 6. Ön değerlendirme formları ve otomatik e-posta

`test.html` sayfasında danışan üye olmadan form doldurur. Gönderince:
- Size **tam rapor** gider (yanıtlar, toplam puan, şiddet düzeyi; PHQ-9'da 9. madde işaretlendiyse konu satırı "⚠ DİKKAT" ile başlar).
- Danışana **yanıtlarının kopyası** gider. Puanlar varsayılan olarak danışana gönderilmez (aşağıdaki `SEND_SCORES_TO_CLIENT` ile açılabilir).
- Kayıt panelde **Testler** sekmesinde görünür.
- Danışan 9. maddeyi işaretlerse sayfada hemen 112 yönlendirmesi gösterilir.

Belirli bir formu doğrudan göndermek için bağlantı: `alanadiniz.com/test.html?form=phq9` (`on-gorusme`, `phq9`, `gad7`, `who5`).

**Kurulum:**
1. https://resend.com → ücretsiz hesap (ayda 3.000 e-posta). **Domains → Add domain** → alan adınızı ekleyin; verdiği DNS kayıtlarını (TXT/MX) GoDaddy DNS'e ekleyin ve doğrulayın. **API Keys** → yeni anahtar oluşturun.
2. Supabase'de `schema.sql` dosyasını yeniden çalıştırın (yeni `assessments` tablosu eklenir; mevcut verilere dokunmaz).
3. Supabase → **Edge Functions → Deploy a new function → Via Editor** → adı `submit-assessment` yapın, `supabase/functions/submit-assessment/index.ts` içeriğini yapıştırıp **Deploy** deyin.
4. Supabase → **Edge Functions → Secrets** bölümüne ekleyin:
   | Ad | Değer |
   |---|---|
   | `RESEND_API_KEY` | Resend'den aldığınız anahtar |
   | `FROM_EMAIL` | `Psk. Heval Deniz Özdemir <form@alanadiniz.com>` |
   | `PSYCHOLOGIST_EMAIL` | Sonuçların gelmesini istediğiniz e-posta |
   | `SITE_URL` | `https://www.alanadiniz.com` (sonunda / olmadan) |
   | `SEND_SCORES_TO_CLIENT` | `false` (danışan puanını da görsün isterseniz `true`) |

**Formları düzenlemek:** Tüm formlar `assets/forms/forms.json` içinde. Soru ekleyebilir, yeni bir form tanımlayabilirsiniz; site ve e-posta fonksiyonu bu dosyayı okur.

**Ölçeklerle ilgili önemli notlar:**
- PHQ-9, GAD-7 ve WHO-5 ücretsiz kullanılabilen ölçeklerdir. Dosyadaki Türkçe ifadeler bu site için hazırlanmış çevirilerdir; **Türkçe geçerlik-güvenirlik çalışması yapılmış resmi formların ifadeleriyle değiştirmeniz** önerilir.
- Beck Depresyon/Anksiyete Envanteri, SCL-90, MMPI gibi telifli envanterleri lisans almadan siteye eklemeyin.
- Formlar sağlık verisi topladığı için KVKK açık rıza kutusu zorunludur. `kvkk.html` metnini hukukçunuza kontrol ettirin.
- Gönderimler e-postayla gelir; anlık takip edilmez. Sayfada acil durumlar için 112 yönlendirmesi bulunur.

## Klasör yapısı

```
index.html  randevu.html  test.html  admin.html  kvkk.html
assets/css/style.css
assets/forms/forms.json  ← ön değerlendirme formları ve ölçekler
assets/js/assessment.js  ← test sayfası
assets/js/config.js    ← ayarlar
assets/js/data.js      ← Supabase / demo veri katmanı
assets/js/main.js      ← menü, çerez onayı, Google Ads
assets/js/booking.js   ← randevu sayfası
assets/js/admin.js     ← yönetim paneli
supabase/schema.sql    ← veritabanı kurulumu
supabase/functions/submit-assessment/index.ts  ← form kaydı + e-posta gönderimi
```

## Önbellek notu
HTML dosyalarındaki `style.css?v=...` ve `.js?v=...` sürüm etiketleri, ziyaretçilerin tarayıcısının eski dosyaları kullanmasını engeller. CSS veya JS dosyalarını değiştirdiğinizde HTML dosyalarındaki `v=` değerini değiştirin (ör. `v=20261101`).
