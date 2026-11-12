<img src="frontend/public/icon-192.png" alt="Clario" width="72" align="left" />

# Clario — İşletme Karar Destek Sistemi

> **Veriyi soruna, sorunu öneriye çeviren sistem.**

Clario, bir işletmenin satış, stok, sipariş, müşteri, ürün ve gider verisini otomatik olarak analiz eder. Sonuçları
grafik yığını olarak değil, **somut risk, fırsat ve aksiyon önerileri** olarak sunar:

```
🔴 Risk: Endüstriyel Yağ Çözücü 5L son 30 günde %27 daha az sattı (3.727 → 2.708 adet).
   Mevcut stok: 13.906 adet. Mevcut satış hızına göre ~5,1 aylık stok var.
   Öneri: Yeni sipariş oluşturma, mevcut stok azaltılmalı: hedef seviyenin (~2 ay) üzerinde
   ~8.490 adet fazla stok var (≈₺1.511.220 bağlı sermaye).

🟢 Fırsat: Bursa bölgesinde El Dezenfektanı 1L satışı son 3 haftada %36 arttı (1.177 → 1.595 adet).
   Öneri: İstanbul bölgesinden Bursa bölgesine +1.500 adet stok aktarımı yapılabilir.

🟠 Kayıp riski: Boğaziçi Hijyen Ltd. normalde ~7 günde bir sipariş veriyor, ancak 59 gündür
   sipariş vermedi (tipik aralığın 8,4 katı). Aylık ~₺244.727 ciro risk altında.
```

*Bu çıktılar, analiz motorunu doğrulamak için üretilen test verisi üzerinde `npm run verify` komutunun gerçek çıktısıdır.*

> **Kendi verinizle çalışır.** Uygulama boş başlar; verilerinizi **Veri Yönetimi** sayfasından Excel şablonuyla toplu
> olarak yükler veya formlarla tek tek eklersiniz. Ayrıntılar: [Veri girişi](#veri-girişi).

## 📱 Android uygulamasını indirin

**[apk/Clario.apk](apk/Clario.apk)** — bilgisayar gerekmez; uygulama ve verileriniz tamamen telefonda çalışır.

1. `Clario.apk` dosyasını telefona indirin (GitHub'da dosyaya dokunup **Download / İndir**).
2. Dosyaya dokunun → "Bilinmeyen kaynaklardan yüklemeye izin ver" sorulursa izin verin → **Yükle**.
   Play Protect uyarı verirse **Yine de yükle** (uygulama Play Store dışından yüklendiği için çıkar).
3. Clario'yu açın, kendi hesabınızı oluşturun. Hesap ve veriler yalnızca o telefonda, parolanızla şifreli durur.

Android 7.0 ve üzeri. Ayrıntılar: [Android uygulaması (APK)](#android-uygulaması-apk).

---

## İçindekiler

- [Neden var?](#neden-var)
- [Modüller](#modüller)
- [Mimari](#mimari)
- [Kurulum](#kurulum)
- [Analiz mantığı](#analiz-mantığı)
- [API](#api)
- [Clario Asistan](#ai-business-assistant)
- [Hesaplar ve güvenlik](#hesaplar-ve-güvenlik)
- [Gündem ve bildirimler](#gündem-ve-bildirimler)
- [Para birimi](#para-birimi)
- [Departman ve proje](#departman-ve-proje)
- [Raporlar](#raporlar)
- [Ekstre ve raporlar](#ekstre-ve-raporlar)
- [Arama](#arama)
- [Cari hesap ve alacak takibi](#cari-hesap-ve-alacak-takibi)
- [e-Fatura ve ERP aktarımı](#e-fatura-ve-erp-aktarımı)
- [Veri girişi](#veri-girişi)
- [Android uygulaması (APK)](#android-uygulaması-apk)
- [Test verisi ve enjekte edilen senaryolar](#test-verisi-ve-enjekte-edilen-senaryolar)
- [Başka sistemlere bağlanma ve ölçekleme](#başka-sistemlere-bağlanma-ve-ölçekleme)
- [Test ve doğrulama](#test-ve-doğrulama)
- [Proje yapısı](#proje-yapısı)
- [Sonraki adımlar](#sonraki-adımlar)

---

## Neden var?

KOBİ sahipleri verilerini genellikle Excel'de tutar ve yorumlamayı kendileri yapmak zorundadır. Klasik dashboard'lar da
"ne oldu?" sorusunu grafikle cevaplar; **"ne yapmalıyım?"** sorusunu kullanıcıya bırakır. Clario şu zinciri
otomatikleştirir:

| Adım | Soru | Örnek |
|---|---|---|
| **Veri** | Ne oldu? | X ürününün son 30 günlük satışı 2.708 adet |
| **Sorun** | Bu normal mi? | Önceki 30 güne göre %27 düşüş; stok 5,1 ay yetiyor, yani fazla stok var |
| **Öneri** | Ne yapmalıyım? | Yeni sipariş verme; ~8.490 adet fazla stok için kampanya planla |
| **Öncelik** | Önce hangisi? | Etki ₺1,8 Mn, aylık cironun ~%32'si → yüksek öncelik |

## Modüller

Modüller frontend'de ayrı sayfalardır (sol menü, React Router). Clario Asistan ise ayrı bir sayfa değildir: her sayfanın **sağ altında süzülen asistan karakterinden** açılır ve sayfalar arasında gezinirken sohbet geçmişi korunur.

| # | Sayfa | Ne gösterir |
|---|---|---|
| 1 | **Genel Bakış** | Ciro, sipariş, aktif müşteri ve tahmini net kâr KPI'ları; açık risk/fırsat sayıları; 26 haftalık ciro grafiği; öncelikli aksiyonlar |
| 2 | **Satış Analizi** | Ürün/bölge bazında son 30 gün ile önceki 30 günün karşılaştırması, **"ciro neden değişti?"** açıklaması, haftalık trend, marj tablosu |
| 3 | **Stok Analizi** | Stok kaç ay yeter, stok uyarıları, bölgeler arası transfer fırsatları, renkli ürün × bölge stok tablosu |
| 4 | **Müşteri Analizi** | Kayıp riski taşıyan müşteriler, ABC segment dağılımı (donut grafik), müşterilerin sipariş ritmi |
| 5 | **Risk Tespiti** | Satış düşüşü, fazla stok ve tükenme riski; kart veya liste görünümü |
| 6 | **Öneriler** | Risk, fırsat ve müşteri kaybının tek listede birleştirilmiş, etkiye göre önceliklendirilmiş hali |
| — | **Raporlar** | Satışların **yıl, ay, tarih aralığı, kategori, ürün, müşteri, müşteri tipi, bölge, departman, proje ve sipariş durumuna** göre filtrelenmiş özeti: KPI'lar (önceki eşit dönemle karşılaştırmalı), ciro grafiği, tüm boyutlarda kırılım, sipariş listesi. Bkz. [Raporlar](#raporlar) |
| — | **Departman & Proje** | Her departmanın ve projenin cirosu, ürün maliyeti, giderleri ve **net katkısı** (son 30 gün / tüm zamanlar); zarar eden departman ve projeler için uyarı |
| — | **Veri Yönetimi** | Verilerin Excel ile toplu yüklenmesi (şablon, kontrol raporu, içe aktarma) ve formlarla tek tek eklenip düzenlenmesi. Bkz. [Veri girişi](#veri-girişi). |
| 7 | **Clario Asistan** | Sağ altta süzülen, gözleri imleci takip eden küre biçimli karakter. Tıklayınca sohbet paneli açılır; soru analiz edilirken karakter "düşünür", cevap gelince sevinir. Serbest metin soruyu ilgili analize yönlendirir, gerçek veriyle cevaplar ve ilgili sayfaya bağlantı verir. Mobilde tam ekran açılır. |


## Mimari

```
┌─────────────────────────────┐   HTTP · JSON (REST)   ┌──────────────────────────────────────────────┐
│  Frontend                   │ ─────────────────────▶ │  Backend — Express 5 + TypeScript            │
│  React 19 + TS + Vite       │   GET /api/risks …     │                                              │
│  React Router · Recharts    │ ◀───────────────────── │  http/routes ──▶ analysis/* ──▶ repositories │
│  axios (src/api)            │   { items: [...] }     │                    ▲               │         │
│  localhost:5180             │                        │  assistant/ ───────┘               ▼         │
└─────────────────────────────┘                        │  (niyet → analiz)          db/DbClient       │
                                                       └────────────────────────────────┬─────────────┘
                                                              localhost:4000/api        │
                                                                              node:sqlite (şimdi) / Postgres (ileride)
```

**İki taraf nasıl haberleşiyor?**

- Frontend yalnızca REST API üzerinden veri alır; iş mantığı yoktur. Adres `frontend/.env` dosyasındaki
  `VITE_API_BASE_URL` değişkeninden okunur. Varsayılan değer göreli `/api` yoludur; Vite geliştirme sunucusu bu istekleri
  backend'e (`API_PROXY_TARGET`, varsayılan `http://localhost:4000`) iletir. Böylece tarayıcı açısından istek aynı kaynaklıdır
  ve uygulama yerel ağdaki diğer cihazlardan da çalışır.
- Her endpoint için `src/api` altında tipli bir fonksiyon (`getRisks`, `askAssistant`…) vardır. Yanıt tipleri
  `src/types` altında backend ile birebir tanımlanmıştır.
- Arayüz API'ye aynı adres üzerinden (Vite proxy) eriştiği için CORS gerekmez ve varsayılan olarak kapalıdır; başka bir
  adresten erişilecekse `CORS_ORIGINS` ile açıkça izin verilir.
- Oturum `HttpOnly` + `SameSite=Strict` çerezle taşınır; oturum yoksa analiz ve veri endpoint'leri `401` döner.
  Bkz. [Hesaplar ve güvenlik](#hesaplar-ve-güvenlik).
- Hatalar her zaman `{ "error": { "message": "…" } }` biçimindedir. Frontend bu mesajı "tekrar dene" düğmeli hata
  panelinde gösterir. Henüz veri yoksa API `503` döner ve arayüz kullanıcıyı Veri Yönetimi sayfasına yönlendirir.
- Tüm analizler verideki **son sipariş tarihini** "bugün" (`asOf`) kabul eder; böylece veri seti ne zaman üretilmiş
  olursa olsun sonuçlar tutarlıdır.

**Backend katmanları:**

| Katman | Görev |
|---|---|
| `db/` | Veritabanından bağımsız `DbClient` arayüzü ve Node'un yerleşik `node:sqlite` modülü üzerine adaptör. Uygulamanın geri kalanı SQLite'ı tanımaz. |
| `repositories/` | Taşınabilir SQL sorguları. Yalnızca veri getirir, yorum yapmaz. |
| `analysis/` | İş mantığının kalbi. Eşikleri veriye uygular; tespitleri "durum → öneri → etki" biçiminde üretir. |
| `assistant/` | Metin normalizasyonu, niyet eşleme, bölge/ürün tanıma ve niyet başına cevap üreticileri. |
| `http/` | Route'lar, girdi doğrulama, CORS, güvenlik başlıkları, CSRF koruması, istek sınırlama ve merkezi hata yönetimi. |
| `auth/` · `security/` | Hesaplar, oturumlar, şifreli çalışma alanları; scrypt, AES-256-GCM ve kurtarma anahtarı. |
| `workspace/` | Oturum açan kullanıcının çalışma alanına bağlı tüm endpoint'ler (her hesabın kendi veritabanı). |
| `news/` | Gündem: RSS okuyucu, kural tabanlı haber sınıflandırma ve haberlerin işletme verisiyle ilişkilendirilmesi. |

## Kurulum

**Gereksinim:** [Node.js 24+](https://nodejs.org) (npm ile birlikte gelir). Başka bir şey gerekmez: veritabanı için Node'un yerleşik SQLite modülü (`node:sqlite`) kullanılır, native derleme veya ayrı bir veritabanı sunucusu yoktur.

### Hızlı kurulum (önerilen)

```bash
cd clario
npm run setup    # backend + frontend bağımlılıklarını kurar
npm run dev      # API ve arayüzü birlikte başlatır
```

Ardından tarayıcıda **http://localhost:5180** adresini açın, **hesap oluşturun** ve kurulum adımlarını izleyin
(para birimi, gündem ve bildirimler, veri yükleme).
`npm run dev` iki sunucuyu tek terminalde başlatır; `Ctrl+C` ikisini de kapatır.

### Adım adım kurulum

**1. Backend** (birinci terminal):

```bash
cd clario/backend
npm install
npm run dev      # API → http://localhost:4000/api (hesaplar ilk kayıtta oluşturulur)
```

**2. Frontend** (ikinci terminal):

```bash
cd clario/frontend
npm install
npm run dev      # Arayüz → http://localhost:5180
```

`.env` dosyası oluşturmak **gerekmez**; tüm ayarların çalışan varsayılanları vardır. Değiştirmek isterseniz
`backend/.env.example` ve `frontend/.env.example` dosyalarını `.env` adıyla kopyalayın.

| Değişken | Dosya | Varsayılan | Açıklama |
|---|---|---|---|
| `PORT` | `backend/.env` | `4000` | API portu |
| `DATA_DIR` | `backend/.env` | `data` | Hesaplar ve şifreli kullanıcı verileri (yedeklerken klasörün tamamını alın) |
| `CORS_ORIGINS` | `backend/.env` | — (kapalı) | Arayüz başka bir adresten sunuluyorsa izin verilen adresler (virgülle ayrılmış) |
| `COOKIE_SECURE` | `backend/.env` | istek HTTPS ise | `true`: oturum çerezi yalnızca HTTPS'te gönderilir (internete açık kurulum) |
| `TRUST_PROXY` | `backend/.env` | `false` | nginx/Caddy gibi bir ters vekil arkasında `true` |
| `LOGIN_LOCKOUT_MINUTES` | `backend/.env` | `0` (kapalı) | Hatalı giriş koruması: 5 hatalı parolada hesap bu kadar dakika kilitlenir; IP başına deneme sınırı da açılır |
| `APP_URL` | `backend/.env` | `http://localhost:5180` | Arayüzün açıldığı adres (Google dönüş adresi bundan üretilir) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `backend/.env` | — | Google ile giriş (bkz. [Google ile giriş](#google-ile-giriş)) |
| `VITE_API_BASE_URL` | `frontend/.env` | `/api` | Arayüzün API'ye ulaştığı yol (Vite proxy'si üzerinden) |
| `API_PROXY_TARGET` | `frontend/.env` | `http://localhost:4000` | Vite'in `/api` isteklerini ilettiği backend adresi |

### Komutlar

| Nerede | Komut | Açıklama |
|---|---|---|
| kök | `npm run setup` | Bağımlılıkları kurar |
| kök | `npm run dev` | API ve arayüzü birlikte başlatır |
| kök | `npm run stop` | Başka bir terminalde veya arka planda açık kalmış Clario sunucularını kapatır (yalnızca Clario'yu; aynı portu kullanan başka uygulamalara dokunmaz) |
| kök | `npm test` / `npm run typecheck` / `npm run lint` | Testler, iki paketin tip kontrolü, lint |
| kök | `npm run build` / `npm start` | Production derlemesi / derlenmiş API'yi çalıştırma |
| `backend/` | `npm run db:reset -- --yes` | Bu kurulumdaki **tüm hesapları ve verilerini siler** (backend kapalıyken; onay parametresi zorunludur) |
| `backend/` | `npm run seed` | Analiz motorunu doğrulamak için **ayrı** bir test veritabanı (`data/test.db`) üretir; işletme verinize dokunmaz |
| `backend/` | `npm run verify` | Tüm tespitleri yazdırır, enjekte edilen senaryoları somut sayılarla doğrular |
| `backend/` | `npm run verify:robustness` | Seed'i 20 farklı tarihle üretip senaryoların her seferinde bulunduğunu doğrular |
| `frontend/` | `npm run build` / `npm run preview` | Arayüzün production derlemesi / önizlemesi |

### Aynı ağdaki başka bir cihazdan açma

Geliştirme sunucusu yerel ağa açıktır. `npm run dev` çıktısındaki **Network** adresini (ör. `http://192.168.1.x:5180`)
aynı Wi-Fi ağındaki telefon, tablet veya başka bir bilgisayarda açın. API istekleri Vite üzerinden bu bilgisayardaki
backend'e iletildiği için ek ayar gerekmez.

- Birden fazla Network adresi görünüyorsa Wi-Fi/Ethernet adaptörünüze ait olanı kullanın (`192.168.56.x` gibi adresler
  genellikle sanal makine adaptörleridir).
- Windows ilk çalıştırmada Node.js için güvenlik duvarı izni sorabilir; bağlı olduğunuz ağ türü için izin verin.
- Bu ayar yalnızca geliştirme içindir; uygulamayı güvenmediğiniz ağlarda açık bırakmayın.

### Sorun giderme

- **"Port 4000 başka bir uygulama tarafından kullanılıyor"**: Başka bir uygulama portu tutuyor. Onu kapatın ya da
  `backend/.env` içinde `PORT=4100` gibi farklı bir port seçin. Bu durumda `frontend/.env` içinde
  `API_PROXY_TARGET=http://localhost:4100` yapın.
- **Arayüz sabit 5180 portunda çalışır** (Vite'ın varsayılanı 5173 başka projelerle çakıştığı için). Port doluysa Vite hata
  verir: o portu kullanan uygulamayı kapatın. `npm run dev`'i mutlaka `clario` klasöründe çalıştırın; başka bir klasörde
  çalıştırılan komut o klasördeki projeyi açar.
- **Arayüzde "Henüz veri yok"** görünüyorsa henüz satış kaydı girilmemiştir; Veri Yönetimi sayfasından ekleyin.
- **Excel yüklenmiyor**: dosya `.xlsx` biçiminde olmalı (eski `.xls` için Excel'de "Farklı kaydet → .xlsx"), en fazla 25 MB.
- **Arayüzde "Sunucuya ulaşılamadı"** görünüyorsa backend çalışmıyordur ya da `API_PROXY_TARGET` yanlıştır.

## Analiz mantığı

> **Hiçbir sonuç sabit olarak yazılmamıştır.** Analiz fonksiyonları, veritabanındaki gerçek satış, stok ve sipariş
> kayıtları üzerinde her istekte yeniden çalışır. Veri değişirse sonuçlar da değişir. Eşikler tek bir dosyada
> ([`thresholds.ts`](backend/src/config/thresholds.ts)) adlandırılmış sabitler olarak durur ve ayarlanabilir.
> Test verisine bilerek eklenen eğilimleri ([`scenarios.ts`](backend/src/seed/scenarios.ts)) analiz motoru hiç
> okumaz; onları veriden kendisi bulur.

Dört temel analiz, [`backend/src/analytics.ts`](backend/src/analytics.ts) üzerinden `detectRisks`,
`detectOpportunities`, `detectCustomerChurn` ve `marginAnalysis` adlarıyla dışa açılır.

### 1. Risk tespiti (ürün bazında)

| Sinyal | Kural | Eşik |
|---|---|---|
| Satış düşüşü | Son 30 gün satış adedi, önceki 30 güne göre en az %15 düşük | `RISK_DECLINE_THRESHOLD = 0.15` |
| Fazla stok | Stok ÷ aylık satış hızı > 4 ay (satış yokken stok varsa "ölü stok") | `HIGH_STOCK_MONTHS = 4` |
| Tükenme riski | Stok ÷ aylık satış hızı < 1,5 ay | `LOW_STOCK_MONTHS = 1.5` |

Aynı ürünün sinyalleri tek kartta birleşir ve öneri metni sinyal kombinasyonuna göre üretilir. Örneğin "düşüş + fazla stok"
için öneri "yeni sipariş verme, stoğu erit" olur. Fazla stok ve sipariş önerileri hedef stok seviyesine
(`TARGET_STOCK_MONTHS = 2`) göre adet olarak hesaplanır. Düşüşün en çok yaşandığı bölge de raporlanır.

### 2. Fırsat tespiti (ürün × bölge)

1. **Artış:** Son 3 haftanın satışı, önceki 3 haftaya göre en az %20 yüksek (`OPPORTUNITY_GROWTH_THRESHOLD = 0.20`).
2. **Anlamlılık:** Az müşterili kombinasyonlarda 3 haftalık satış doğal olarak dalgalanır. Yanlış alarmı önlemek için artış,
   önceki 12 haftanın olağan dalgalanmasına göre de en az 2 standart sapma yukarıda olmalıdır (`OPPORTUNITY_MIN_Z_SCORE = 2`).
3. **Transfer önerisi:** Bölgenin yeni satış hızıyla 2 aylık stoğa ulaşması için gereken adet hesaplanır. Diğer bölgeler
   arasından **en fazla stoğu olan** seçilir. Bu bölgenin kendi 1,5 aylık ihtiyacı korunarak aktarılabilecek miktar
   önerilir; kalan açık varsa tedarikçi siparişi önerilir.

### 3. Müşteri kaybı (churn)

- Her müşterinin **kendi** tipik sipariş aralığı, ardışık siparişleri arasındaki günlerin **medyanıdır**. Medyan, tek
  seferlik gecikmelere karşı ortalamadan daha dayanıklıdır.
- Sessizlik süresi tipik aralığın **2,5 katını** aşarsa "kayıp riski" (`CHURN_MULTIPLIER = 2.5`), 1,5 katını aşarsa
  "izlemede" sayılır. Tipik aralığın güvenilir olması için en az 4 sipariş gerekir.
- Bu yüzden haftalık sipariş veren bir bayi ~3 hafta sessiz kalınca alarm verir; ayda bir sipariş veren bir mağaza için
  bu süre ~11 haftadır. Sabit bir "X gündür sipariş yok" kuralından daha isabetlidir.
- Öneri, müşterinin satış temsilcisini ve en çok aldığı ürünleri içerir. Müşteriler ayrıca cironun ilk %80'i A, sonraki
  %15'i B, kalanı C olacak şekilde **ABC (Pareto)** segmentlerine ayrılır.

### 4. Marj analizi

Son 90 günün **gerçekleşen** ortalama satış fiyatı (iskontolar sonrası) birim maliyetle karşılaştırılır. Marjı negatif olan
ürün "zarar", %10'un altında olan "düşük marj" (`LOW_MARGIN_THRESHOLD = 0.10`) olarak işaretlenir ve liste en düşük
marjdan başlayarak sıralanır. Test verisinde Streç Film'in liste fiyatı maliyetin üzerindedir, ancak bayi iskontoları
nedeniyle ortalama −%1 marjla satılır.

### 5. "Ciro neden değişti?" ve önceliklendirme

- Toplam ciro değişimi şu bileşenlere ayrıştırılır: ürün ve bölge katkıları; bu dönemde hiç sipariş vermeyen müşterilerin
  kaybı; **fiyat/hacim ayrıştırması** (hacim etkisi = Δadet × eski fiyat, fiyat etkisi = Δfiyat × yeni adet).
- Her tespitin bir ₺ etkisi vardır: kaybedilen ciro, bağlı sermaye, risk altındaki ciro ya da ek ciro potansiyeli.
  Öncelik, etkinin **aylık ciroya oranıyla** belirlenir: en az %3 ise yüksek, en az %1 ise orta. Bu sayede yöntem
  işletmenin ölçeğinden bağımsızdır.

## API

Temel adres: `http://localhost:4000/api`. `http://localhost:4000/api` adresi endpoint listesini de döndürür.

| Method | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/health` | Servis durumu, veritabanı türü, veri tarihi, kayıt sayıları |
| `GET` | `/dashboard/summary` | KPI'lar (önceki döneme göre değişimle), 26 haftalık ciro trendi, ilk 5 öneri |
| `GET` | `/sales/analytics` | Toplamlar, ürün ve bölge karşılaştırmaları, "ciro neden değişti?" açıklaması, haftalık trend, marjlar |
| `GET` | `/inventory/intelligence` | Stok özeti, ürün × bölge stok tablosu, ürün ve bölge düzeyinde uyarılar |
| `GET` | `/customers/analysis` | Durum sayıları, ABC segmentleri, kayıp riskleri, müşteri listesi |
| `GET` | `/customers/churn` | Yalnızca kayıp riski taşıyan müşteriler |
| `GET` | `/risks` | Risk tespitleri (`sales_decline`, `overstock`, `stockout`) |
| `GET` | `/opportunities` | Fırsat tespitleri ve stok transfer önerileri |
| `GET` | `/margins` | Ürün marjları, en düşük marj başta (`loss` / `low` / `healthy`) |
| `GET` | `/recommendations` | Birleştirilmiş ve önceliklendirilmiş aksiyon listesi |
| `GET` | `/reports/options` | Rapor filtrelerinin seçenekleri (kategoriler, ürünler, müşteriler, bölgeler, departman/projeler, veri aralığı) |
| `GET` | `/reports/summary` | `?from&to&category&productId&customerId&customerType&regionId&department&project&status&offset` → filtreli rapor |
| `GET` | `/segments` | Departman ve proje bazında ciro, ürün maliyeti, gider, net katkı ve uyarılar |
| `GET` | `/currency` | İsteğin gösterim para birimi ve kullanılan son kur |
| `GET` `PUT` | `/settings` | Verilerin girildiği (ana) para birimi: `{ "baseCurrency": "TRY" }` |
| `GET` | `/news` | Gündem: haberler, temaları, işletmeye olası etkileri, öneriler ve okunmamış sayısı |
| `POST` | `/news/seen` | Bildirimleri okundu işaretle |
| `GET` | `/auth/status` | Kayıt ekranı bilgisi (ülkeler ve para birimleri, Google, parola kuralı) — oturum gerekmez |
| `POST` | `/auth/register` · `/auth/login` · `/auth/logout` | Hesap aç (kurtarma anahtarı yalnızca bu yanıtta, bir kez) / giriş / çıkış |
| `POST` | `/auth/recover` | `{ email, recoveryKey, newPassword }` — kurtarma anahtarıyla yeni parola |
| `POST` | `/auth/password` · `/auth/recovery-key` | Parola değiştir / yeni kurtarma anahtarı |
| `POST` | `/auth/reset-data` | `{ password }` — işletme verilerini siler; hesap, profil ve ayarlar kalır |
| `DELETE` | `/auth/account` | `{ password }` — hesabı ve şifreli verisini kalıcı olarak sil |
| `GET` | `/auth/google/start` · `/auth/google/callback` | Google'a yönlendirme / Google'dan dönüş (tarayıcı gezinmesi) |
| `GET` `POST` | `/auth/google/pending` · `/auth/google/complete` | Google sonrası beklenen adım / veri parolasıyla tamamlama |
| `POST` | `/auth/google/cancel` · `/auth/google/unlink` | Google adımından vazgeç / Google bağlantısını kaldır |
| `GET` `PATCH` | `/me` | Profil ve kurulum durumu |

`/auth/*` dışındaki tüm endpoint'ler oturum gerektirir (yoksa `401`) ve yalnızca oturum sahibinin verisiyle çalışır.
Veri değiştiren isteklerde `X-Clario-Client` başlığı zorunludur (yoksa `403`).
| `POST` | `/assistant/ask` | `{ "question": "Bu ay neden satışlar düştü?" }` → niyet, güven, cevap |
| `GET` | `/assistant/examples` | Örnek sorular |
| `GET` | `/config/thresholds` | Kullanılan tüm eşik değerleri |
| `GET` `POST` | `/data/{regions,products,customers,employees,expenses}` | Kayıtları listele / yeni kayıt ekle |
| `PUT` `DELETE` | `/data/{…}/:id` | Kaydı güncelle / sil (kullanımdaysa `409`) |
| `GET` `POST` | `/data/orders` | Siparişleri sayfalı listele / ürün satırlarıyla sipariş ekle |
| `PATCH` `DELETE` | `/data/orders/:id` | Siparişin durumunu, departmanını veya projesini değiştir / sil |
| `GET` `PUT` | `/data/inventory` | Ürün × bölge stoklarını oku / toplu yaz |
| `GET` | `/import/template` · `/import/export` | Boş Excel şablonu / mevcut verinin Excel dökümü |
| `POST` | `/import/analyze` | Dosyayı (.xlsx/.csv) okur; her sayfanın tahmini veri türünü ve önerilen sütun eşleştirmesini döner |
| `POST` | `/import?mode=merge\|replace&dryRun=true&skipInvalid=true` | Dosyayı içe aktar (`skipInvalid`: hatalı satırları atla). `X-Clario-Mapping` başlığıyla onaylanan eşleştirme gönderilir. `dryRun` ile yalnızca kontrol raporu; hata varsa `422` ve hiçbir şey kaydedilmez |

**Para birimi:** Analiz endpoint'leri `X-Clario-Currency: USD` başlığı (veya `?currency=USD`) ile tutarları istenen para
biriminde döner. Veri girişi endpoint'leri (`/data`, `/import`) her zaman ana para biriminde çalışır.

**Hata yanıtları:** `400` geçersiz girdi, JSON veya Excel dosyası, `404` bilinmeyen endpoint veya kayıt, `409` çakışma, `502` döviz kuru
servisine ulaşılamadı, `503` henüz veri yok (veri girişine yönlendirmeyle),
`500` beklenmeyen hata. `500` yanıtları hangi isteğin başarısız olduğunu belirtir; iç ayrıntılar yalnızca sunucu loguna
yazılır. Express 5, async route'larda fırlatılan her hatayı merkezi hata middleware'ine
([`http/errors.ts`](backend/src/http/errors.ts)) iletir; bu yüzden route'lar ayrı ayrı `try/catch` ile sarılmaz ve hiçbir
endpoint'in bu korumayı atlaması mümkün değildir.

Risk, fırsat ve kayıp tespitleri ortak bir biçim paylaşır:

```jsonc
{
  "id": "risk-product-4",
  "kind": "risk",                  // risk | opportunity | churn
  "severity": "high",              // high | medium | low
  "title": "Endüstriyel Yağ Çözücü 5L: Satış düşüşü ve fazla stok",
  "message": "… son 30 günde %27 daha az sattı …",    // durum tespiti
  "recommendation": "Yeni sipariş oluşturma, …",       // aksiyon
  "impactAmount": 1784028,         // tahmini finansal etki (₺)
  "impactLabel": "Aylık ciro kaybı + Fazla stokta bağlı sermaye",
  "metrics": { "salesChangePct": -0.2734, "monthsOfStock": 5.14, "excessUnits": 8490 }
}
```

## Clario Asistan

Asistan genel amaçlı bir sohbet botu değildir. Her cevap, veritabanı üzerinde çalışan bir analiz fonksiyonundan gelir.

Analizlerin yanında asistan şunları da yapar:

- **Rapor/ekstre isteği:** "Eylül ekstresini istiyorum", "dünün gün sonu raporu", "son 7 günün raporu pdf" → özet ve
  Excel/PDF/Word indirme düğmeleri (bkz. [Ekstre ve raporlar](#ekstre-ve-raporlar)).
- **Müşteri profili:** Soruda müşteri adı geçerse ("Kuzey Holding ne durumda?", "Kadıköy Market'in son siparişi ne
  zaman?") ciro, son 30 gün değişimi, sipariş ritmi, kayıp riski, en çok aldığı ürünler ve projeler anlatılır.
- Selamlaşmaya kısa bir tanıtımla cevap verir; stok verisi girilmemişse bunu söyler.


```
"Bursa'daki dezenfektan stoğu ne durumda?"
   │ 1. Normalizasyon  → "bursa daki dezenfektan stogu ne durumda"
   │ 2. Niyet puanlama → Stok analizi (anahtar kelime: "stog")
   │ 3. Varlık tanıma  → bölge: Bursa, ürün: El Dezenfektanı 1L
   │ 4. Analiz         → stok analizi veritabanında çalışır, sonuç filtrelenir
   ▼ 5. Cevap
• El Dezenfektanı 1L: toplam 11.941 adet, ~1,8 aylık — Bursa: 1.026 adet (~0,5 ay).
⚠️ Bölgesel: Bursa bölgesinde El Dezenfektanı 1L stoğu ~0,5 aylık; ürünün genel durumu ise sağlıklı.
```

- **12 niyet:** satış değişimi, en çok satanlar, müşteri kaybı, riskler, fırsatlar, stok, marj, kâr/gider, öneriler, genel özet,
  departman/proje ve güncel gündem (bkz. aşağıda).
- **Tamamen Clario'nun kendi ajanı:** Harici yapay zekâ servisi (Claude, OpenAI vb.) kullanılmaz, API anahtarı gerekmez;
  cevaplar yalnızca sorulan soruya ve verideki problemlere yöneliktir.
- **Türkçeye özgü eşleme:** aksan katlama (ş→s, ı→i), ek toleransı için önek eşleme ve ünsüz yumuşaması (stok→stoğu,
  kayıp→kaybı). "kâr" gibi kısa kelimeler tam kelime olarak eşlenir, böylece "karar" kelimesi kâr sorusu sanılmaz.
- **Şeffaflık:** Her cevap seçilen analizi, güven skorunu ve eşleşen anahtar kelimeleri gösterir.
- **Öncül kontrolü:** "Neden satışlar düştü?" sorulduğunda veri artış gösteriyorsa asistan bunu açıkça söyler.

### Gündem ve bildirimler

Sağ üstteki **zil** ve Genel Bakış'taki **Gündem** bölümü, ekonomi haberlerinin ve döviz kurlarının işletmeye olası
etkisini gösterir. Harici yapay zekâ kullanılmaz; her şey Clario'nun kendi kurallarıyla yapılır:

1. **Kaynaklar:** Türkiye'deki işletmeler için Anadolu Ajansı, TRT Haber, Habertürk ve Dünya'nın ekonomi RSS
   beslemeleri; diğer ülkeler için BBC, CNBC, The Guardian ve AA English. Beslemeler 10 dakika önbellekte tutulur; zil 5 dakikada bir ve uygulamaya dönüldüğünde yenilenir, son 7 günün haberleri gösterilir.
2. **Sınıflandırma:** Başlıklar ağırlıklı anahtar kelimelerle 12 temaya ayrılır: faiz, döviz kuru, enflasyon, enerji,
   hammadde, tedarik, talep, ücretler, vergi, dış ticaret, kriz/afet, büyüme. Yön (artış/düşüş) ayrıca bulunur.
   Yanlış alarmlara karşı: "5 milyar dolar ihracat" kur haberi sayılmaz; "savaş gemileri geçti" savaş sayılmaz;
   enerji/hammaddede yön yalnızca fiyat kelimesiyle birlikte geçerlidir; yön belirsizse tahmin yürütülmez.
3. **İşletmeyle ilişkilendirme:** Her tema ve yön için olası etki ve öneri, kullanıcının kendi verisiyle yazılır.
   Kullanılan veriler: fazla stokta bağlı sermaye, bayi payı, düşük marjlı ürünler, lojistik/enerji/personel giderleri,
   tükenme riskindeki ürünler. Bölgenizin (ör. "Bursa'da sel") veya kategori/ürün adınızın geçtiği haberler **önemli**
   olarak öne çıkar.
4. **Kur sinyali:** Verilerin para birimi dolar veya euro karşısında 30 günde %2'den fazla değiştiyse (ECB kurları)
   gündemin başında gösterilir.

Örnek: *"Merkez Bankası politika faizini artırdı"* → **Olası etki:** Kredi ve finansman maliyetleri artabilir; fazla
stokta bağlı ₺1,2 Mn sermayenin finansman maliyeti yükselir. **Öneri:** Fazla stoğu eritmeye öncelik verin.

5. **Clario içinde okuma:** Haber başlığına tıklayınca Clario'nun içinde bir okuyucu açılır: üstte Clario yorumu
   (olası etki ve öneri), altında haberin görseli ve metni. Metin kaynak sayfadan okuma modunda alınır (sayfadaki
   yapısal veri veya `<article>` paragrafları; reklam, menü, betik alınmaz) ve 40 habere kadar önbellekte tutulur.
   Yalnızca gündemdeki haberler açılabilir: istemci adres gönderemez, sunucu rastgele adreslere istek atmaz. Metin
   alınamazsa özet gösterilir. "… sitesinde aç" isteğe bağlıdır: telefonda uygulama içi tarayıcıda açılır (kapatınca
   Clario'ya dönülür), web'de yeni sekmede.

Asistana "Piyasa durumu risklerimi nasıl etkiler?" diye sorulduğunda da aynı değerlendirme kaynaklarıyla gösterilir.
Yorumlar olasılık belirtir, kesin tahmin değildir; hiçbir kullanıcı verisi dışarı gönderilmez.

## Hesaplar ve güvenlik

Uygulamayı kuran herkes kendi hesabını açar. **Her hesabın verisi ayrıdır ve şifrelidir**; bir hesap başka bir hesabın
verisini göremez.

**Giriş akışı:** açılış ekranı → giriş / kayıt → (ilk girişte) kurulum: tanıtım, verilerin para birimi, gündem
ve bildirimler, veri yükleme → uygulama. Kurulum Ayarlar'dan tekrar gösterilebilir.

**Şifreleme modeli**

```
parola ──scrypt (N=2^17)──▶ parola anahtarı ─┐
                                              ├─ sarar (AES-256-GCM) ─▶ veri anahtarı (rastgele 256 bit)
kurtarma anahtarı ──HKDF──▶ kurtarma anahtarı ┘                              │
                                                                             ▼
                                  data/users/<id>.clario  ◀── AES-256-GCM ── SQLite veritabanının tam görüntüsü
```

- Her hesabın rastgele bir **veri anahtarı** vardır; kullanıcının tüm verisi (satışlar, müşteriler, ayarlar, e-posta,
  ayarlar) bu anahtarla **AES-256-GCM** ile şifrelenmiş tek bir dosyada durur. GCM etiketi sayesinde dosyada
  tek bir bayt değiştirilse bile açılmaz.
- Veri anahtarı diskte yalnızca **sarılmış** halde durur: paroladan türetilen anahtarla ve kayıtta bir kez gösterilen
  **kurtarma anahtarıyla**. Parola hiçbir yerde saklanmaz; doğrulama, veri anahtarının açılabilmesiyle yapılır.
- Veritabanı giriş yapıldığında **bellekte** açılır; diske hiçbir zaman düz metin yazılmaz. Her değişiklikten sonra
  şifrelenip atomik olarak (geçici dosya + yeniden adlandırma) kaydedilir. Son oturum kapanınca veri anahtarı bellekten
  silinir. Sunucu yeniden başlarsa herkes tekrar giriş yapar — veri o ana kadar kilitlidir.
- `system.db` kişisel veri içermez: e-posta yalnızca anahtarlı özet (HMAC-SHA256) olarak durur.
- **Sonuç:** Veri klasörünün tamamı kopyalansa bile parola veya kurtarma anahtarı olmadan veri okunamaz. Bedeli:
  parola ve kurtarma anahtarı birlikte kaybedilirse veri **kurtarılamaz** (Clario dahil kimse sıfırlayamaz).

**Web güvenliği**

| Tehdit | Önlem |
|---|---|
| Oturum çalma (XSS) | Oturum çerezi `HttpOnly` (JavaScript okuyamaz); React çıktıyı kaçışlar; haber bağlantılarında yalnızca `http(s)` |
| CSRF | Çerez `SameSite=Strict`; veri değiştiren her istek `X-Clario-Client` başlığı ister (formlar ekleyemez, betikler CORS'a takılır) |
| Kaba kuvvet | scrypt (her deneme ≈0,3 sn). İsteğe bağlı (`LOGIN_LOCKOUT_MINUTES`, varsayılan kapalı): hesap başına 5 hatalı denemede kilit ve IP başına deneme sınırı |
| Hesap tespiti | Olmayan e-posta ve yanlış parola aynı mesajı ve aynı süreyi verir |
| Oturum ömrü | 12 saat hareketsizlik veya 7 gün sonra kapanır; parola değişince diğer cihazlardaki oturumlar kapanır |
| Veri sızması | Yanıtlar `Cache-Control: no-store`; `X-Frame-Options: DENY`, `nosniff`, kısıtlı CSP; iç hata ayrıntıları istemciye gönderilmez |
| Bağımlılıklar | `npm audit`: 0 açık (exceljs'in `uuid` bağımlılığı `overrides` ile güncel sürüme sabitlendi) |

**İnternete açarken:** HTTPS arkasında çalıştırın (`COOKIE_SECURE=true`, ters vekil kullanıyorsanız `TRUST_PROXY=true`)
ve hatalı giriş korumasını açın (ör. `LOGIN_LOCKOUT_MINUTES=15`).
Yerel ağda (`http://192.168…`) çerez Secure olmadan çalışır; ağdaki trafik şifrelenmediği için güvenilir ağlarda kullanın.

### Google ile giriş

Giriş ekranında **Google ile devam et** seçilebilir. Kimliği Google doğrular; **verinin kilidini ise veri parolası açar**.
Clario Google parolanızı hiç görmediği için şifreleme anahtarı Google girişinden türetilemez; bu sayede şifreleme modeli
aynı kalır (veri klasörü çalınsa da veri açılmaz).

| Durum | Google'dan dönünce |
|---|---|
| İlk kez | Veri parolası belirlenir (parola kurallarıyla aynı), kurtarma anahtarı gösterilir, hesap açılır |
| Google'a bağlı hesap | Veri parolası girilir |
| Aynı e-postayla açılmış parolalı hesap | O hesabın parolası girilir ve Google bağlanır (yeni hesap açılmaz) |

Veri parolası neden 4–6 haneli bir PIN değil: şifreli dosya ele geçirilirse PIN'ler çevrimdışı olarak dakikalar içinde
denenebilir; en az 10 karakterlik bir parola bunu pratikte imkânsız kılar. Google'ın çalışmadığı yerlerde (ör. yerel
ağdaki başka bir cihaz) aynı hesaba **e-posta + veri parolasıyla** da girilebilir. Bağlantı Ayarlar'dan kaldırılabilir.

**Güvenlik:** OpenID Connect Authorization Code akışı + **PKCE (S256)**; `state` sunucuda tutulur ve tarayıcıya çerezle
bağlanır (başkasının başlattığı girişe sürüklenme / giriş CSRF'si engellenir), tek kullanımlıktır ve 10 dakikada dolar;
`nonce`, `aud`, `iss`, `exp` ve `email_verified` denetlenir. Google hesap kimliği yalnızca anahtarlı özet (HMAC) olarak
saklanır. Google doğrulaması tek başına oturum açmaz. Harici kütüphane kullanılmaz.

**Kurulum (uygulamayı kuran kişi, bir kez, ~5 dakika):**

1. [Google Cloud Console → API'ler ve Hizmetler → Kimlik bilgileri](https://console.cloud.google.com/apis/credentials)
   adresinde bir proje seçin veya oluşturun.
2. İstenirse **OAuth izin ekranını** yapılandırın (Harici, uygulama adı "Clario", destek e-postası). Test aşamasında
   giriş yapacak Google hesaplarını "Test kullanıcıları"na ekleyin veya uygulamayı yayınlayın.
3. **Kimlik bilgisi oluştur → OAuth istemci kimliği → Web uygulaması.** "Yetkilendirilmiş yönlendirme URI'leri"ne
   `http://localhost:5180/api/auth/google/callback` ekleyin (farklı adres kullanıyorsanız `<APP_URL>/api/auth/google/callback`).
4. Verilen değerleri `backend/.env` dosyasına yazın ve backend'i yeniden başlatın:

```bash
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
# APP_URL=http://localhost:5180     # arayüzün açıldığı adres (varsayılan)
```

Google, dönüş adresi olarak yalnızca `localhost` veya HTTPS'li bir alan adı kabul eder. Bu yüzden Google ile giriş
`APP_URL` adresinden açıldığında çalışır; yerel ağdaki başka bir cihazdan (`http://192.168…`) açıldığında düğme yerine
bu bilgi gösterilir ve e-posta + parola kullanılır. İnternete HTTPS'li bir alan adıyla açılırsa `APP_URL`'yi o adres yapın.

**Yeni hesaplar boş başlar:** Örnek/demo veri yoktur; her kullanıcı yalnızca kendi girdiği verileri görür ve bu veriler
bir sonraki girişte aynen yerindedir.

### Veriler nerede saklanıyor: yerel mi, bulut mu?

**Karar: yerel (uygulamanın kurulu olduğu bilgisayar).** Nedenleri:

- **Gizlilik ve mevzuat:** Satış, müşteri ve kâr verisi işletmenin en hassas verisidir. Veri kurulumun yapıldığı makineden
  çıkmaz; KVKK/GDPR açısından üçüncü taraf bir sunucuya veri aktarımı yoktur.
- **Maliyet ve bakım yok:** Sunucu, veritabanı hizmeti veya aylık ücret gerekmez; internet olmadan da çalışır (yalnızca
  döviz kurları ve gündem internet ister).
- **Şifreleme modeli buna uygun:** Anahtar paroladan türetildiği için veri, uygulamanın kendisi dahil kimse tarafından
  parola olmadan okunamaz.

Veriler `backend/data/` klasöründe, her hesap için ayrı şifreli bir SQLite veritabanı olarak durur. **Yedek:** bu klasörü
düzenli olarak (ör. harici disk veya kendi bulut sürücünüz) kopyalayın; dosyalar şifreli olduğu için bulut sürücüde de güvenlidir.

**Buluta ne zaman geçilmeli?** Aynı veriye internet üzerinden farklı yerlerden erişilecekse veya uygulama bir hizmet (SaaS)
olarak sunulacaksa. Mimari buna hazırdır: veritabanı katmanı soyuttur (Postgres adaptörü yazılabilir), şifreleme istemci
parolasına bağlı olduğu için bulut sağlayıcı bile veriyi okuyamaz; sunucu HTTPS arkasında `COOKIE_SECURE=true` ile çalıştırılır.

## Para birimi

Veriler tek bir **ana para biriminde** girilir (Veri Yönetimi → "Verilerin para birimi"; varsayılan TL). Sol menüdeki
seçimle analizler desteklenen 30 para biriminden herhangi birinde gösterilebilir:

- Her satış **sipariş gününün**, her gider **gider gününün** kuruyla çevrilir. Böylece enflasyon/kur değişimi dönemler
  arası karşılaştırmayı bozmaz: "dolar bazında ciro" gerçekten dolar bazındadır.
- Ürün maliyeti de satışla aynı günün kuruyla çevrildiği için **marj oranları para biriminden bağımsızdır**.
- Tarihi olmayan tutarlar (stok değeri, ürün liste fiyatı) son kurla çevrilir.
- Kurlar **Avrupa Merkez Bankası (ECB)** günlük referans kurlarıdır ([frankfurter.dev](https://frankfurter.dev), anahtar
  gerektirmez). Verinin kapsadığı tüm tarih aralığı tek istekte çekilip veritabanında saklanır; hafta sonu ve tatiller
  önceki iş gününün kuruyla doldurulur. İnternet yoksa ana para birimi çalışmaya devam eder.
- Veri girişi ekranları, Excel şablonu ve dışa aktarma her zaman ana para biriminde kalır (başlıklar ör. "Tutar ($)").
- **Ülkeden otomatik:** Kayıtta ad ve ülke zorunludur; verilerin para birimi seçilen ülkeden belirlenir (Almanya → EUR,
  Japonya → JPY). Ülkenin para birimi kur kaynağında yoksa (ör. Suudi Arabistan riyali) ABD doları önerilir. Kurulumda
  veya Veri Yönetimi'nden değiştirilebilir. Ülke ayrıca gündemde hangi ülkenin haber kaynaklarının kullanılacağını belirler.
- Desteklenen para birimleri: ECB'nin günlük kur yayımladığı 30 para birimi (TRY, USD, EUR, GBP, CHF, JPY, CNY, …).

## Departman ve proje

Satışlara (sipariş düzeyinde) ve giderlere opsiyonel **Departman** ve **Proje** bilgisi girilebilir: Excel'de
"Departman", "Bölüm", "Masraf Merkezi", "Proje", "Proje Adı", "İş Emri" gibi sütunlar otomatik tanınır; formlarda da
alanlar vardır (daha önce girilen adlar öneri olarak çıkar). Gider türü artık zorunlu değildir: yalnızca departman/proje
bazlı takip edenler için boş bırakılırsa "Genel" yazılır.

**Departman & Proje** sayfası her biri için `net katkı = ciro − ürün maliyeti − giderler` hesaplar (son 30 gün ve tüm
zamanlar), zarar edenleri uyarır ve kayıtların ne kadarına departman/proje girildiğini gösterir. Hizmet işletmelerinde
ürün maliyeti yoksa maliyetler proje giderlerinden gelir. Asistana "Hangi proje zarar ediyor?" diye sorulabilir.

## Raporlar

Genel özetin istenen duruma göre süzülmüş hali. Filtreler birlikte uygulanır ve URL'de tutulur (rapor bağlantısı
paylaşılabilir, tarayıcının geri tuşu çalışır).

| Filtre | Seçenekler |
|---|---|
| Dönem | Tüm zamanlar, bu ay, geçen ay, son 30/90 gün, bu yıl, geçen yıl, **belirli bir yıl**, **belirli bir ay**, **tarih aralığı** |
| Boyutlar | Kategori, ürün (kategoriye göre daralır), müşteri, müşteri tipi, bölge, departman, proje ("Atanmamış" dahil) |
| Durum | Teslim edilenler (varsayılan), iptal edilenler, tümü |

- **Karşılaştırma:** Her KPI, seçilen dönemle aynı uzunluktaki hemen önceki dönemle karşılaştırılır (ör. Ağustos ↔ Temmuz).
- **Grafik:** 45 güne kadar günlük, 200 güne kadar haftalık, daha uzun dönemlerde aylık; satış olmayan dilimler sıfır gösterilir.
- **Kırılım ve detaya inme:** Kategori/ürün/müşteri/bölge/departman/proje tablosunda bir satıra tıklamak onu filtre yapar.
- **Giderler ve net katkı:** Yalnızca dönem, bölge, departman ve proje filtrelerinde hesaplanır (giderler ürüne veya
  müşteriye bağlı değildir). Net katkı = ciro − maliyeti bilinen ürünlerin maliyeti − giderler.
- Tutarlar seçili gösterim para biriminde, her satış kendi tarihindeki kurla çevrilir. Tüm filtre değerleri SQL'e
  parametre olarak geçer.

## Ekstre ve raporlar

**Raporlar → Ekstre & İndir** sekmesi, Analiz sekmesindeki "Bu dönemi indir" düğmesi veya **asistan**
("Eylül ekstresini istiyorum", "dünün gün sonu raporu", "15 Ekim raporu pdf", "son 7 günün raporu", "01.09.2026 ile
15.09.2026 arası"): asistan dönemi ve biçimi metinden çıkarır, özeti yazar ve indirme düğmelerini gösterir.

| Tür | Dönem | Dosya |
|---|---|---|
| Aylık ekstre | Seçilen ay (varsayılan: geçen ay) | **Excel** (ve PDF): Özet, Günlük, Kategoriler, Ürünler, Müşteriler, Projeler, Giderler, İşlemler sayfaları |
| Gün sonu raporu | Seçilen gün | **PDF** veya **Word** |
| Dönem raporu | İstenen tarih aralığı | **PDF** veya **Word** |

İçerik: ciro, sipariş, ortalama sipariş, müşteri, adet, brüt kâr ve marj, giderler, net katkı, iptaller, yeni müşteriler
(önceki eşit dönemle karşılaştırmalı); otomatik "öne çıkanlar" cümleleri; günlük döküm; kategori, ürün, müşteri, bölge,
proje kırılımları; gider türleri ve dönemin tüm işlemleri. Excel sunucuda/cihazda (exceljs), PDF (pdfmake) ve Word (docx)
arayüzde üretilir; telefonda paylaş menüsüyle kaydedilir. API: `GET /api/statements?kind=monthly&month=YYYY-AA`
(`kind=daily&date=…`, `kind=range&from=…&to=…`), `GET /api/statements/export.xlsx?…`.

**Bildirimler:** Her ayın 1'inde geçen ayın ekstresi, işlem yapılan günlerde ayarlanan saatte (varsayılan 18:00) gün
sonu raporu zilde görünür. Zil 5 dakikada bir ve uygulamaya dönüldüğünde yenilenir; yeni önemli haberler ve raporlar
**sistem bildirimi** olarak da gelir (telefonda Android bildirimi; bilgisayarda Ayarlar'dan izin verilirse tarayıcı
bildirimi, sekme arka plandayken). Telefonda ekstre (ayın 1'i 09:00) ve gün sonu hatırlatmaları uygulama kapalıyken
de gelir; veriler şifreli olduğu için bu hatırlatmalar genel metindir, dokununca rapor açılır ve tutarlar orada
hesaplanır. Haber bildirimleri uygulama açıkken (ön veya arka planda çalışırken) gelir. Ayarlar → Bildirimler'den
açılıp kapatılır ve gün sonu saati seçilir.

## Cari hesap ve alacak takibi

**Cari & Alacak** sayfası (menüde): kimden ne kadar alacak olduğu, vadesi geçenler, tedarikçi borçları ve önümüzdeki
30 günün nakit görünümü.

- **Faturalar** teslim edilen satışlardır (e-Fatura ile gelenlerde KDV dahil fatura toplamı, yoksa satır tutarları).
  **Vade:** faturadaki vade tarihi → müşterinin vadesi (Müşteriler: "Vade (gün)") → genel varsayılan (30 gün).
- **Tahsilatlar** (Veri Yönetimi → Tahsilatlar, Excel şablonundaki "Tahsilatlar" sayfası veya ERP dökümü) müşterinin
  en eski vadeli faturasından başlayarak mahsup edilir (FIFO). Fazla ödeme avans olarak eksi bakiye görünür.
- **Takip başlangıcı:** ilk kurulumda seçilir; bu tarihten önceki satış ve tahsilatlar hesaba katılmaz (geçmiş
  veriler yanlışlıkla "vadesi geçmiş" görünmez).
- **Göstergeler:** toplam alacak, vadesi geçen (müşteri sayısıyla), yaşlandırma (vadesi gelmemiş / 1–30 / 31–60 /
  61–90 / 90+ gün), ortalama tahsil süresi (DSO = alacak ÷ son 90 günün günlük satışı), kredi limiti aşımları,
  tedarikçi borcu (ödenmemiş gelen faturalar; "Ödendi" ile kapatılır) ve haftalara bölünmüş 30 günlük tahsilat/ödeme görünümü.
- **Cari hesap ekstresi:** müşteriye dokununca faturalar (borç), tahsilatlar (alacak), yürüyen bakiye ve açık
  faturalar; Excel olarak indirilir.
- **Bildirim:** her pazartesi vadesi geçen alacaklar ve o hafta ödenecek borçlar zile düşer.
- **Asistan:** "Kimden alacağımız var?", "Vadesi geçen alacaklar", "Bu hafta ne ödeyeceğiz?", "Nakit durumu";
  müşteri profilinde ("Kuzey Holding ne durumda?") cari bakiye ve limit de yazılır.
- Tutarlar verilerin para biriminde tutulur (cari bakiye kur farkıyla değişmez). API: `GET /api/receivables`,
  `GET /api/receivables/customers/:id` (`/ledger.xlsx`), `PUT /api/receivables/settings`, `/api/data/payments`,
  `PATCH /api/data/expenses/:id/paid`.

## e-Fatura ve ERP aktarımı

Veri Yönetimi → Excel ile yükle ekranı Excel/CSV'nin yanında **e-Fatura** dosyalarını da kabul eder:

- **Biçim:** GİB UBL-TR XML (e-Fatura, e-Arşiv). Tek `.xml` veya çok sayıda XML içeren `.zip` (GİB portalı,
  entegratör ya da ERP dışa aktarımı; iç içe ZIP'ler dahil).
- **Giden / gelen ayrımı:** Ayarlardaki firma vergi numarası (Cari & Alacak → Takip ayarları); boşsa yüklenen
  faturaların hepsinde geçen VKN firmamız sayılır ve kaydedilir.
  - Giden faturalar → **Satışlar**: fatura no, tarih, müşteri ve VKN/TCKN, şehir (bölge), kalemler (kod, ad, miktar,
    indirim sonrası birim fiyat), vade ve KDV dahil toplam.
  - Gelen faturalar → **Giderler** ("Alış faturası"): tedarikçi, KDV hariç tutar (kâr hesabı), KDV dahil toplam
    (borç takibi), vade, fatura no.
- Döviz faturalar belgedeki kurla (PricingExchangeRate) TL'ye çevrilir. İade faturaları satış analizine alınmaz.
- Faturalar eşleştirme ekranında "e-Fatura Satışlar" ve "e-Fatura Alışlar" sayfaları olarak görünür; kontrol raporu
  ve mükerrer koruması Excel aktarımıyla aynıdır: aynı arşiv tekrar yüklenince kayıtlar çoğalmaz (fatura no), müşteri
  adı farklı yazılmış olsa da **vergi numarasıyla** eşleşir.
- **ERP (Logo, Mikro ve benzerleri):** Satış, cari ve tahsilat raporlarının Excel dökümü doğrudan yüklenebilir;
  "Fiş No", "Evrak No", "Fiş Tarihi", "Cari Hesap Ünvanı", "Malzeme Kodu", "Malzeme Açıklaması", "Stok Kodu",
  "Birim Fiyatı", "Vade Tarihi", "VKN/TCKN" gibi başlıklar tanınır. Canlı (otomatik) ERP bağlantısı için verilerin bir
  sunucuda tutulması gerekir; bkz. [Başka sistemlere bağlanma ve ölçekleme](#başka-sistemlere-bağlanma-ve-ölçekleme).

## Arama

Üst çubuktaki arama kutusu (sağ üstte, zilin yanında; kısayol **/** veya **Ctrl+K**) tüm verilerde arar:

| Sonuç | Neyle bulunur | Tıklayınca |
|---|---|---|
| Müşteriler | Ad ("ozturk" → "Öztürk") | Müşterinin raporu (tüm zamanlar); sipariş sayısı, ciro, son sipariş tarihi listede |
| İşlemler | Sipariş/fatura no ("F-12"), Clario no ("#12"); tek müşteri bulunduysa son işlemleri | İşlem ayrıntısı: kalemler, birim fiyat, tutar, temsilci, departman/proje |
| Ürünler | Ad veya ürün kodu | Ürünün raporu |
| Kategoriler, bölgeler, departman ve projeler | Ad | İlgili filtreyle rapor |
| Giderler | Açıklama, gider türü, proje (aynı giderler tek satırda: "İstanbul depo kirası · 7 kayıt") | Giderler sekmesi |

Türkçe harf ve büyük/küçük harf fark etmez; kelimeler baştan eşleşir ("ist" İstanbul'u bulur, "Lojistik"i bulmaz).
Ok tuşları ve Enter ile seçilir. Telefonda büyüteç simgesine dokununca üst çubuk boyunca açılır. Tutarlar seçili
gösterim para birimindedir. API: `GET /api/search?q=` ve `GET /api/orders/:id`.

## Veri girişi

Clario boş başlar; tüm analizler sizin girdiğiniz veriden hesaplanır. **Veri Yönetimi** sayfasında iki yol vardır:

### 1. Excel / CSV ile toplu yükleme

**Kendi tablonuzu olduğu gibi yükleyebilirsiniz.** Clario başlıkları anlamlarına göre tanır: "Miktar", "Adet", "Qty" →
adet; "Tutar", "Toplam", "Ciro", "KDV Hariç Tutar" → satır tutarı; "Cari Adı", "Firma", "Müşteri Unvanı" → müşteri;
"Fatura Tarihi", "İşlem Tarihi" → tarih; "İl", "Şehir", "Şube" → bölge gibi. Sayfa adı önemli değildir ("Sayfa1" olabilir);
her sayfanın satış mı, ürün mü, stok mu, gider mi olduğu içeriğinden tahmin edilir. Başlık satırı en üstte olmak zorunda
değildir, "Toplam" satırları atlanır. Dosyayı seçince Clario eşleştirmeyi gösterir; yanlış bir eşleştirmeyi açılır
listeden düzeltebilirsiniz.

- **Dağınık tablolar:** gruplanmış/birleştirilmiş hücrelerde boş kalan tarih ve müşteri üstteki satırdan tamamlanır;
  eksi veya sıfır adetli satırlar (iade, düzeltme) ve not satırları hata sayılmaz, uyarıyla atlanır.
- **Hatalı satırlar:** "Kontrol et" raporunda hatalar türüne göre gruplanır (ör. "Adet geçerli bir sayı değil — satır 43, 84,
  125"). Dosyayı düzeltip tekrar kontrol edebilir ya da **"Hatalı N satırı atlayarak içe aktar"** ile geri kalanını kaydedebilirsiniz
  (API: `skipInvalid=true`). Eksik sütun eşleştirmesi gibi yapısal hatalar atlanamaz.

- **Düz satış tablosu yeterlidir:** tarih, müşteri, ürün (kod veya ad) ve adet ya da tutar. Tabloda geçen ama sistemde
  olmayan ürün, müşteri ve bölgeler otomatik oluşturulur; birim fiyat yoksa tutar ÷ adet ile hesaplanır.
- **Eksik bilgi yanıltmaz:** ürün maliyeti girilmemişse kâr "bilinmiyor" gösterilir (sahte %100 marj yerine) ve ürün marj
  analizine alınmaz; stok girilmemişse stok uyarısı üretilmez.
- **Biçimler:** `.xlsx` ve `.csv` (`;` veya `,` ayraçlı, UTF-8 ya da Türkçe Windows kodlaması). Tarihler `25.09.2026`,
  `2026-09-25`, `25 Eylül 2026` veya Excel tarih hücresi; tutarlar `1.250,50` gibi Türkçe biçimde olabilir.

Sıfırdan başlıyorsanız hazır şablonu kullanabilirsiniz:

1. **Şablonu indirin.** Şablonda Ürünler, Müşteriler, Satışlar, Stok, Giderler, Bölgeler ve Çalışanlar sayfaları ile
   bir "Nasıl Doldurulur" sayfası vardır. Zorunlu sütunlar işaretlidir, başlıklarda açıklama notları, "Tip" ve "Durum"
   sütunlarında açılır liste bulunur.
2. **Doldurup yükleyin.** Dosya önce **kontrol edilir**: hiçbir şey kaydedilmeden eklenecek/güncellenecek kayıtların
   özeti ve hatalı satırlar (sayfa + Excel satır numarası + ne yanlış) gösterilir.
3. **İçe aktarın.** Hata yoksa her şey tek bir veritabanı işleminde kaydedilir; bir sorun çıkarsa hiçbir değişiklik kalmaz.

| Mod | Davranış |
|---|---|
| **Ekle / güncelle** | Yeni kayıtlar eklenir; ürünler ürün koduna (SKU), müşteriler ve çalışanlar ada, siparişler sipariş numarasına göre güncellenir. Aynı dosyayı tekrar yüklemek kayıtları çoğaltmaz. |
| **Tümünü değiştir** | Mevcut tüm iş verisi silinir, yerine dosyadaki veriler yazılır (onay istenir). |

- Tarihler `25.09.2026` veya Excel tarih biçiminde; tutarlar `1.250,50` gibi Türkçe biçimde de girilebilir.
- Satış satırlarında sipariş numarası yoksa aynı gün + aynı müşteri satırları tek sipariş sayılır. Birim fiyat boşsa
  ürünün liste fiyatı kullanılır. Diğer sayfalarda geçen bölgeler otomatik olarak eklenir.
- **Mevcut verilerimi indir** ile tüm verinizi aynı şablon biçiminde alıp Excel'de düzenleyebilir ve geri yükleyebilirsiniz.

### 2. Uygulama içinden tek tek

Bölge, ürün, müşteri, çalışan ve gider için ekle/düzenle/sil formları; birden fazla ürün satırı olan satış (sipariş)
girişi, siparişi iptal etme, siparişe sonradan departman/proje atama; ürün × bölge stok tablosunun doğrudan düzenlenmesi. Veri bütünlüğü korunur: satışı olan bir
ürün veya siparişi olan bir müşteri silinemez, aynı adla ikinci kayıt açılamaz ve kullanıcıya nedeni açıkça söylenir.

> Risk ve fırsat analizleri, karşılaştırma yaptıkları için en az **2–3 aylık satış geçmişi** ile anlamlı sonuç verir.
> Tek tek girişte geçmiş satışları Excel ile toplu yüklemek çok daha hızlıdır.

## Android uygulaması (APK)

Clario telefonda **bilgisayara ihtiyaç duymadan** çalışır: backend (hesaplar, şifreleme, analizler, raporlar, asistan,
gündem) uygulamanın içinde, telefonun kendisinde çalışır. APK dosyasını başkalarına gönderebilirsiniz; herkes kendi
hesabını açar ve verisi yalnızca kendi telefonunda durur.

**Kurulum (telefonda):** `Clario.apk` dosyasını telefona gönderin (WhatsApp, e-posta, Drive, USB) → dosyaya dokunun →
"Bilinmeyen kaynaklardan yüklemeye izin ver" sorulursa izin verin → Yükle. (Play Store dışından yüklenen uygulamalar
için Android bu izni ister; Play Protect bir uyarı gösterebilir, "Yine de yükle" seçilir.) Android 7.0 ve üzeri.

**Nasıl çalışır?**

- Arayüz web sürümüyle aynı React kodudur. Backend kodu da aynıdır; Node.js modülleri telefonda karşılıklarıyla
  çalışır (`mobile/src/shims/`): SQLite → sql.js (WebAssembly), şifreleme → denetlenmiş @noble kütüphaneleri
  (AES-256-GCM, scrypt, HKDF), dosyalar → uygulamanın özel depolama alanı. HTTP sunucusu yoktur; arayüzün istekleri
  uygulama içinde doğrudan backend'e iletilir (`mobile/src/adapter.ts`).
- **Veriler:** Her hesabın verisi telefonun uygulamaya özel alanında, parolayla şifreli durur. Başka uygulamalar
  erişemez; uygulama silinirse veriler de silinir. Telefonu değiştirmeden önce Veri Yönetimi → "Mevcut verilerimi
  indir" ile Excel yedeği alın, yeni telefonda içe aktarın.
- **İnternet** yalnızca döviz kurları ve gündem için gerekir; geri kalan her şey çevrimdışı çalışır.
- Uygulama tamamen kapatılıp açılınca yeniden giriş istenir (oturum anahtarı yalnızca bellekte tutulur).
- Telefonda parola anahtarı türetme maliyeti N=2¹⁶'dır (bilgisayarda 2¹⁷); her hesap kendi parametresini saklar.
- Google ile giriş telefonda yoktur (e-posta + parola kullanılır). Dosyalar (ekstre, rapor, şablon, dışa aktarım, kurtarma
  anahtarı) telefonun **Belgeler/Clario** klasörüne kaydedilir; ardından çıkan bildirimden **Aç** veya **Paylaş** seçilebilir. Android geri tuşu açık okuyucuyu/aramayı kapatır, sonra önceki sayfaya döner.

**APK üretmek (geliştirici):**

```bash
cd mobile
npm install
npm run apk        # → mobile/release/Clario.apk (imzalı)
```

Gerekenler: Android Studio (Android SDK) ve **JDK 21**. Betik JDK'yı sırayla `CLARIO_JAVA_HOME`,
`~/.clario-build/jdk/jdk-21*` ve `JAVA_HOME`'da arar. Android Studio'nun JDK 25'i bu Gradle sürümüyle çalışmaz.

**İmza anahtarı:** `mobile/android/clario-release.keystore` ve parolası `mobile/android/keystore.properties`'te
(ikisi de git'e girmez). **Bu iki dosyayı güvenli bir yere yedekleyin:** kaybolursa yeni sürümler telefondaki
uygulamanın üzerine güncelleme olarak yüklenemez (önce eskisini silmek gerekir; veriler de silinir).
Tarayıcıda deneme: `npm run build && npm run preview` → http://localhost:5190 (aynı cihaz içi backend).

## Test verisi ve enjekte edilen senaryolar

Analiz motorunun doğruluğunu kanıtlamak için `npm run seed`, temizlik, hijyen ve kağıt ürünleri dağıtan kurgusal bir
**B2B toptancı** için 6 aylık test verisi üretir. Bu veri **ayrı** bir dosyaya (`data/test.db`) yazılır, testler ve
`npm run verify` tarafından kullanılır; uygulamada görünmez ve işletme verinize karışmaz. Tüm isimler kurgusaldır.

| Varlık | Adet | Not |
|---|---|---|
| Bölge / Ürün | 5 / 12 | İstanbul, Ankara, İzmir, Bursa, Antalya · 5 kategori |
| Müşteri | 30 | Bayiler haftalık, mağazalar haftada 1–2 kez sevkiyat alır |
| Sipariş | ~860 | **~6.550 satış kaydı**, ~%1,5 iptal |
| Çalışan / Gider | 12 / 70 | Personel, kira, lojistik, enerji, pazarlama, genel yönetim |

Analiz motorunun gerçekten çalıştığını göstermek için veriye bilerek üç eğilim eklenir:

| # | Senaryo | Veriye eklenen | Motorun bulduğu |
|---|---|---|---|
| a | Satış düşüşü + fazla stok | Bir ürünün talebi son 30 günde düşer, stoğu ~5 aylık kalır | 🔴 Risk: −%27, 5,1 ay stok |
| b | Bölgesel talep artışı | Bir ürünün Bursa'daki talebi son 3 haftada artar | 🟢 Fırsat: +%36, İstanbul'dan transfer |
| c | Sessizleşen bayiler | 3 bayi haftalık düzenli siparişten sonra ~8 hafta sessiz kalır | 🟠 3 kayıp riski, yanlış alarm yok |

## Başka sistemlere bağlanma ve ölçekleme

Uygulama, veri kaynağından bağımsız olacak şekilde katmanlanmıştır:

1. **Otomatik veri aktarımı.** ERP/muhasebe yazılımı (Logo, Mikro, Netsis vb.), e-ticaret veya POS sisteminden veriyi
   düzenli olarak almak için, kaynaktan okuyup [`import/importer.ts`](backend/src/import/importer.ts) motoruna aynı
   biçimde veren bir bağlayıcı yazmak yeterlidir; doğrulama ve eşleştirme kuralları Excel yüklemesiyle aynıdır.
   Şema [`db/schema.ts`](backend/src/db/schema.ts) dosyasındadır.
2. **Veritabanını büyütün.** Tüm erişim [`DbClient`](backend/src/db/types.ts) arayüzü üzerinden yapılır ve sorgular
   taşınabilir SQL ile yazılmıştır (tarih hesapları TypeScript'te, parametreler `?`). Postgres için bu arayüzü `pg`
   ile uygulayan bir adaptör yazmak ve [`db/index.ts`](backend/src/db/index.ts) içinde seçmek yeterlidir.
3. **Eşikleri ayarlayın.** [`thresholds.ts`](backend/src/config/thresholds.ts) içindeki değerleri sektöre göre
   güncelleyin. Örneğin hızlı tüketim ürünlerinde hedef stok süresi daha kısa olabilir.

Analiz, API ve arayüz katmanları bu değişikliklerden etkilenmez.

## Test ve doğrulama

```bash
cd clario/backend
npm test                     # 139 test · bellek içi veritabanı · sabit tarih
npm run seed                 # test veritabanını üretir (data/test.db)
npm run verify               # test verisinde tüm tespitler + senaryo kontrolü
npm run verify:robustness    # 20 farklı tarihle seed → senaryolar her seferinde bulunuyor mu?
```

- **Birim:** medyan, değişim oranı, stok sınıflandırma, ABC segmentasyonu, anlamlılık testi, önceliklendirme.
- **Senaryo:** üç eğilimin tespit edilmesi ve düzenli müşterilerde yanlış kayıp alarmı olmaması.
- **Asistan:** 14 örnek sorunun doğru analize yönlenmesi, bölge/ürün tanıma, anlaşılamayan soru davranışı.
- **API:** tüm endpoint'ler, girdi doğrulama, CORS, 404, boş veritabanı (503), veritabanı hatasında anlamlı 500.
- **Para birimi:** her günün cirosunun o günün kuruyla çevrilmesi, marj oranlarının para biriminden bağımsızlığı, kurların
  tek seferde çekilmesi, kur servisi yokken 502 ve ana para biriminin çalışmaya devam etmesi (sahte kur kaynağıyla, ağsız).
- **Gündem:** RSS okuma (CDATA, HTML, karakter kodları, güvensiz bağlantılar), 25 örnek başlığın doğru temaya ve yöne
  ayrılması (yanlış alarmlar dahil), bölgesi geçen haberin öne çıkması, etkinin işletme verisiyle açıklanması, eski
  haberlerin elenmesi, önbellek, kapalı kaynak, okunmamış sayısı, kur sinyali, asistan cevabı (sahte besleme, ağsız).
- **Departman ve proje:** Excel sütunlarının tanınması, sipariş düzeyinde proje, net katkı ve zarar uyarıları, elle atama.
- **Hesaplar ve şifreleme:** hiçbir dosyada e-posta, kayıt veya parolanın düz metin olmaması; kurcalanan
  dosyanın reddedilmesi; hesaplar arası veri yalıtımı; kilitleme; kurtarma anahtarıyla parola yenileme; parola değişince
  diğer oturumların kapanması; CSRF ve CORS; yeni hesabın boş başlaması; verileri sıfırlama.
- **Raporlar:** dönem, kategori, müşteri, bölge, durum ve departman/proje filtrelerinin toplamlarının doğrudan SQL ile
  birebir tutması; önceki dönem; grafik dilimleri; sayfalama; para birimi çevrimi; geçersiz filtrelerin reddi.
- **Google ile giriş:** ilk giriş / bağlı hesap / aynı e-postalı hesaba bağlama akışları, başka tarayıcıda başlatılmış
  veya tekrar kullanılan `state`'in reddi, kısa PIN'in reddi, kimlik bilgisinde `aud`/`iss`/`exp`/`nonce`/`email_verified`
  denetimi, PKCE; Google kimliğinin ve e-postanın hiçbir dosyada düz metin olmaması (sahte Google ile, ağsız).
- **Kendi tablolarını yükleme:** farklı başlıklı, başlığı 3. satırda, "Toplam" satırı olan düz satış tablosunun tanınması ve
  içe aktarılması; ürün/müşteri/bölgelerin otomatik oluşması; fiyatın tutardan hesaplanması; `;` ayraçlı Türkçe CSV;
  kullanıcının düzelttiği eşleştirmenin uygulanması; maliyet/stok girilmemişken sahte kâr ve stok uyarısı üretilmemesi; gruplanmış hücrelerin tamamlanması, iadelerin atlanması ve
  hatalı satırları atlayarak içe aktarma.
- **Veri girişi:** form kayıtları ve hata durumları (çakışma 409, geçersiz sayı 400, kullanımdaki kaydı silme); Excel'e
  aktarılan verinin boş sisteme geri yüklenince **analizlerin birebir aynı çıkması**; aynı dosyanın ikinci kez yüklenince
  kayıtları çoğaltmaması; hatalı satırların sayfa + satır numarasıyla raporlanıp hiçbir şeyin kaydedilmemesi.
- **Frontend:** TypeScript strict mod, oxlint. 6 sayfa ve asistan balonu headless Chrome ile test edildi: soru-cevap, sayfa değişince geçmişin korunması, Esc ile kapatma, mobilde tam ekran. Konsol hatası yok.

## Proje yapısı

```
clario/
├── package.json              # setup · dev · test · build (kök komutlar)
├── scripts/dev.mjs           # iki sunucuyu birlikte başlatır
├── mobile/                   # Android uygulaması (Capacitor): cihaz içi backend, shims, APK betiği
├── backend/
│   ├── .env.example
│   ├── src/
│   │   ├── index.ts          # sunucu giriş noktası
│   │   ├── app.ts            # Express uygulaması (testlerde de kullanılır)
│   │   ├── analytics.ts      # detectRisks · detectOpportunities · detectCustomerChurn · marginAnalysis
│   │   ├── config/           # env, thresholds (tüm eşikler)
│   │   ├── db/               # DbClient arayüzü, SQLite adaptörü, şema
│   │   ├── repositories/     # taşınabilir SQL sorguları
│   │   ├── analysis/         # risk, fırsat, müşteri, marj, satış, stok, öneri, dashboard
│   │   ├── assistant/        # normalizasyon, niyetler, varlık tanıma, cevap üreticileri
│   │   ├── data/             # veri girişi: doğrulama, kayıt ekle/düzenle/sil
│   │   ├── import/           # sütun eşleştirme (mapping), Excel şablonu/dışa aktarma, içe aktarma motoru
│   │   ├── http/             # route'lar, CORS, hata yönetimi
│   │   ├── seed/             # test verisi: katalog, senaryolar, veri üretici
│   │   └── scripts/          # verify, robustness, reset-db
│   └── test/
└── frontend/
    ├── .env.example
    └── src/
        ├── api/              # axios istemcisi + endpoint başına tipli fonksiyon
        ├── types/            # backend yanıt tipleri
        ├── hooks/useApi.ts   # yükleme / hata / veri durumu, istek iptali
        ├── components/       # StatCard, RiskCard, OpportunityCard, ChurnCard, Sidebar, AssistantWidget…
        ├── pages/            # 6 analiz sayfası + Veri Yönetimi (lazy-load)
        ├── theme.ts          # koyu/açık tema, grafik paleti
        └── index.css         # tasarım sistemi (CSS değişkenleri)
```

## Sonraki adımlar

- **Otomatik veri entegrasyonu:** ERP/muhasebe yazılımları (Logo, Mikro, Netsis), e-ticaret ve POS sistemleri için
  mevcut içe aktarma motorunu kullanan bağlayıcılar; zamanlanmış (gecelik) senkronizasyon; Postgres adaptörü.
- **Ekip hesapları:** aynı şirket verisini paylaşan davetli kullanıcılar ve rol bazlı yetki (yönetici, satış temsilcisi,
  depo); iki adımlı doğrulama (TOTP); Microsoft/Apple ile giriş.
- **Asistanın gelişimi:** konuşma bağlamı ("peki Bursa'da?"), sorudaki tarihleri anlama ("Mart 2026'da en çok satan"),
  yazım hatası toleransı; istenirse bilgisayarda çalışan açık kaynak bir dil modeli (ör. Ollama) — veri yine dışarı çıkmaz.
- **Bildirim sistemi:** Yeni yüksek öncelikli risk veya kayıp riski oluştuğunda e-posta, Slack/Teams veya WhatsApp
  bildirimi; haftalık özet raporu; bildirim eşiklerinin kullanıcı tarafından ayarlanması.
- **Diğer:** eşiklerin arayüzden ayarlanması, önerilere "uygulandı / yok sayıldı" geri bildirimi ve sonuç takibi,
  talep tahmini (mevsimsellik).
