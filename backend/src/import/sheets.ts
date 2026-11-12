/**
 * Veri türlerinin (sayfaların) ve alanlarının tanımı.
 *
 * Her alanın eş anlamlı başlık listesi vardır; böylece kullanıcının kendi hazırladığı Excel
 * tablosundaki "Miktar", "Tutar", "Cari Adı" gibi başlıklar da doğru alana eşlenir.
 * Şablon üretimi, dışa aktarma ve içe aktarma aynı tanımı kullanır.
 */

export type ColumnType = 'text' | 'number' | 'integer' | 'date';

export interface ColumnSpec {
  key: string;
  header: string;
  type: ColumnType;
  /** Tek başına zorunlu mu? (Alternatifli zorunluluklar SheetSpec.requireAny'dedir.) */
  required: boolean;
  width: number;
  /** Excel'de açılır liste olarak sunulacak değerler */
  choices?: string[];
  /** Kullanıcı tablolarında bu alanı ifade edebilecek başlıklar (Türkçe/İngilizce) */
  synonyms: string[];
  note: string;
  /** false ise şablonda sütun olarak yer almaz, yalnızca kullanıcı tablolarında tanınır */
  inTemplate?: boolean;
}

export type SheetKey = 'regions' | 'products' | 'employees' | 'customers' | 'sales' | 'inventory' | 'expenses' | 'payments';

export interface SheetSpec {
  key: SheetKey;
  title: string;
  description: string;
  /** Sayfa adında geçerse bu türe işaret eden kelimeler */
  nameHints: string[];
  columns: ColumnSpec[];
  /** Her grup için en az bir alan eşleşmiş olmalı (ör. ürün kodu VEYA ürün adı) */
  requireAny?: string[][];
}

type Extra = Partial<Omit<ColumnSpec, 'key' | 'header' | 'type' | 'required'>>;

function col(key: string, header: string, type: ColumnType, required: boolean, note: string, synonyms: string[], extra: Extra = {}): ColumnSpec {
  const width = type === 'date' ? 16 : type === 'text' ? 22 : 18;
  return { key, header, type, required, width, note, synonyms: [header, ...synonyms], ...extra };
}

const REGION = ['bölge', 'bölge adı', 'şehir', 'il', 'depo', 'şube', 'lokasyon', 'satış bölgesi', 'region', 'city', 'branch', 'location'];
const PRODUCT_CODE = ['ürün kodu', 'stok kodu', 'sku', 'malzeme kodu', 'mal kodu', 'kod', 'barkod', 'malzeme/hizmet kodu', 'hizmet kodu', 'stok kartı kodu', 'product code', 'item code', 'product id'];
const PRODUCT_NAME = ['ürün', 'ürün adı', 'ürün ismi', 'ürün tanımı', 'stok adı', 'stok ismi', 'malzeme', 'malzeme adı', 'malzeme açıklaması', 'malzeme/hizmet açıklaması', 'mal adı', 'mal hizmet', 'mal/hizmet', 'hizmet', 'ürün/hizmet', 'product', 'product name', 'item', 'item name'];
const CATEGORY = ['kategori', 'ürün grubu', 'ürün kategorisi', 'grup', 'category', 'product group'];
const DEPARTMENT = ['departman', 'departman adı', 'bölüm', 'iş birimi', 'masraf merkezi', 'maliyet merkezi', 'department', 'division', 'business unit', 'cost center'];
const PROJECT = ['proje', 'proje adı', 'proje kodu', 'proje no', 'iş', 'iş adı', 'iş kodu', 'iş emri', 'project', 'project name', 'project code', 'job'];
const TAX_ID = ['vergi no', 'vergi numarası', 'vkn', 'tckn', 'vkn/tckn', 'vergi kimlik no', 'tc kimlik no', 'vergi/tc no', 'tax id', 'vat number'];
const DUE_DATE = ['vade', 'vade tarihi', 'son ödeme tarihi', 'ödeme vadesi', 'vadesi', 'due date', 'payment due'];
const CUSTOMER_NAME = ['müşteri adı', 'cari', 'cari adı', 'cari hesap', 'cari unvan', 'cari ünvanı', 'cari hesap unvanı', 'cari hesap ünvanı', 'cari hesap adı', 'firma', 'firma adı', 'unvan', 'ünvan', 'alıcı', 'bayi', 'customer', 'customer name', 'client', 'company'];
const UNIT_COST = ['maliyet', 'birim maliyet', 'alış fiyatı', 'alış', 'geliş fiyatı', 'cost', 'unit cost', 'purchase price'];

export const SHEETS: readonly SheetSpec[] = [
  {
    key: 'regions',
    title: 'Bölgeler',
    description: 'Satış yaptığınız bölgeler / depolar. Diğer sayfalarda geçen bölgeler otomatik olarak da eklenir.',
    nameHints: ['bölge', 'bolge', 'region', 'şube', 'depo'],
    columns: [col('name', 'Bölge', 'text', true, 'Ör. İstanbul', REGION)],
  },
  {
    key: 'products',
    title: 'Ürünler',
    description: 'Sattığınız ürünler. Ürün kodu (SKU) her ürün için benzersiz olmalıdır.',
    nameHints: ['ürün', 'urun', 'product', 'stok kart', 'malzeme'],
    requireAny: [['sku', 'name']],
    columns: [
      col('sku', 'Ürün Kodu (SKU)', 'text', false, 'Benzersiz kod, ör. URN-001. Boşsa ürün adından üretilir.', PRODUCT_CODE),
      col('name', 'Ürün Adı', 'text', false, 'Ürün veya hizmetin adı', PRODUCT_NAME, { width: 32 }),
      col('category', 'Kategori', 'text', false, 'Ürün grubu, ör. Hizmet, Yazılım, Malzeme (boşsa "Genel")', CATEGORY),
      col('unitCost', 'Birim Maliyet (₺)', 'number', false, 'Size maliyeti (alış fiyatı). Boşsa marj analizine dahil edilmez.', UNIT_COST),
      col('listPrice', 'Liste Fiyatı (₺)', 'number', true, 'İskontosuz satış fiyatı', ['liste fiyatı', 'satış fiyatı', 'fiyat', 'birim fiyat', 'etiket fiyatı', 'price', 'list price', 'sales price']),
    ],
  },
  {
    key: 'employees',
    title: 'Çalışanlar',
    description: 'Opsiyonel. Satış temsilcileri müşterilere atanabilir; maaşlar giderlere dahil değildir (giderleri ayrıca girin).',
    nameHints: ['çalışan', 'calisan', 'personel', 'employee', 'staff', 'ekip'],
    columns: [
      col('fullName', 'Ad Soyad', 'text', true, 'Ör. Ayşe Yılmaz', ['adı soyadı', 'isim', 'ad', 'çalışan', 'personel', 'name', 'full name', 'employee']),
      col('role', 'Görev', 'text', true, 'Ör. Satış Temsilcisi', ['pozisyon', 'unvan', 'ünvan', 'rol', 'title', 'position', 'role']),
      col('region', 'Bölge', 'text', false, 'Opsiyonel', REGION),
      col('monthlySalary', 'Aylık Maaş (₺)', 'number', true, 'Brüt aylık maaş', ['maaş', 'ücret', 'brüt maaş', 'net maaş', 'salary']),
      col('hireDate', 'İşe Başlama Tarihi', 'date', false, 'Opsiyonel, ör. 01.03.2024', ['işe başlama', 'işe giriş tarihi', 'giriş tarihi', 'başlangıç tarihi', 'hire date', 'start date']),
    ],
  },
  {
    key: 'customers',
    title: 'Müşteriler',
    description: 'Size satış yaptığınız bayiler ve mağazalar. Müşteri adı benzersiz olmalıdır.',
    nameHints: ['müşteri', 'musteri', 'cari', 'customer', 'client', 'bayi'],
    columns: [
      col('name', 'Müşteri Adı', 'text', true, 'Ör. Anadolu Ticaret Ltd.', ['müşteri', 'cari', 'cari adı', 'cari hesap', 'cari unvan', 'firma', 'firma adı', 'unvan', 'ünvan', 'bayi', 'customer', 'client', 'company']),
      col('customerType', 'Tip', 'text', false, 'Bayi veya Mağaza (boşsa Bayi)', ['müşteri tipi', 'müşteri türü', 'tür', 'kanal', 'segment', 'type', 'customer type'], { choices: ['Bayi', 'Mağaza'], width: 12 }),
      col('region', 'Bölge', 'text', false, 'Ör. İstanbul (boşsa "Merkez")', REGION),
      col('salesRep', 'Satış Temsilcisi', 'text', false, 'Opsiyonel; Çalışanlar sayfasındaki ad soyad', ['temsilci', 'plasiyer', 'satış sorumlusu', 'sorumlu', 'satıcı', 'sales rep', 'salesperson']),
      col('taxId', 'Vergi / TC No', 'text', false, 'Opsiyonel: VKN (10 hane) veya TCKN (11 hane); e-Fatura eşleştirmesinde kullanılır', TAX_ID),
      col('paymentTermDays', 'Vade (gün)', 'integer', false, 'Opsiyonel: faturada vade yoksa kaç gün sonra ödeneceği (boşsa genel ayar)', ['vade günü', 'vade süresi', 'ödeme süresi', 'payment terms', 'term days']),
      col('creditLimit', 'Kredi Limiti (₺)', 'number', false, 'Opsiyonel: bu müşteriye açık hesap limiti; aşılınca uyarılır', ['kredi limiti', 'risk limiti', 'limit', 'cari limit', 'credit limit']),
    ],
  },
  {
    key: 'sales',
    title: 'Satışlar',
    description:
      'Her satır bir satış kalemidir. Bir siparişte birden fazla ürün varsa aynı Sipariş No ile birden fazla satır girin. ' +
      'Kendi satış tablonuzu da yükleyebilirsiniz: tarih, müşteri, ürün ve adet ya da tutar yeterlidir. ' +
      'Analizler için en az son 2–3 ayın satışlarını girmeniz önerilir.',
    nameHints: ['satış', 'satis', 'sales', 'sipariş', 'siparis', 'fatura', 'order', 'invoice'],
    requireAny: [['sku', 'productName'], ['quantity', 'lineTotal']],
    columns: [
      col('orderNo', 'Sipariş No', 'text', false, 'Aynı siparişin satırlarında aynı numara. Boşsa tarih + müşteri ile gruplanır.', ['sipariş numarası', 'fatura no', 'fatura numarası', 'belge no', 'fiş no', 'fiş numarası', 'irsaliye no', 'evrak no', 'evrak sıra no', 'fatura belge no', 'order no', 'order number', 'order id', 'invoice no', 'invoice number'], { width: 16 }),
      col('orderDate', 'Tarih', 'date', true, 'Sipariş tarihi, ör. 25.09.2026', ['satış tarihi', 'sipariş tarihi', 'fatura tarihi', 'işlem tarihi', 'belge tarihi', 'fiş tarihi', 'evrak tarihi', 'düzenleme tarihi', 'date', 'order date', 'invoice date', 'sale date']),
      col('customer', 'Müşteri', 'text', true, 'Müşteri adı', CUSTOMER_NAME, { width: 30 }),
      col('sku', 'Ürün Kodu (SKU)', 'text', false, 'Ürün kodu (veya Ürün Adı sütunu)', PRODUCT_CODE),
      col('productName', 'Ürün Adı', 'text', false, 'Ürün adı (veya Ürün Kodu sütunu)', PRODUCT_NAME, { inTemplate: false }),
      col('quantity', 'Adet', 'number', false, 'Satılan miktar (veya Tutar sütunu)', ['miktar', 'sayı', 'satış adedi', 'satılan adet', 'satış miktarı', 'quantity', 'qty', 'units', 'pcs']),
      col('unitPrice', 'Birim Satış Fiyatı (₺)', 'number', false, 'Boşsa tutar ÷ adet veya ürünün liste fiyatı kullanılır', ['birim fiyat', 'birim fiyatı', 'fiyat', 'satış fiyatı', 'birim satış fiyatı', 'unit price', 'price', 'sales price']),
      col('lineTotal', 'Tutar (₺)', 'number', false, 'Satır tutarı (adet × birim fiyat)', ['tutar', 'toplam', 'toplam tutar', 'satış tutarı', 'satır tutarı', 'net tutar', 'kdv hariç tutar', 'ciro', 'hasılat', 'gelir', 'total', 'amount', 'line total', 'revenue'], { inTemplate: false }),
      col('status', 'Durum', 'text', false, 'Teslim edildi (varsayılan) veya İptal', ['sipariş durumu', 'status'], { choices: ['Teslim edildi', 'İptal'], width: 16 }),
      col('department', 'Departman', 'text', false, 'Opsiyonel: satışı yapan departman/birim, ör. Kurumsal Satış', DEPARTMENT),
      col('project', 'Proje', 'text', false, 'Opsiyonel: satışın ait olduğu proje veya iş, ör. Merkez Ofis Kurulumu', PROJECT),
      col('dueDate', 'Vade Tarihi', 'date', false, 'Opsiyonel: faturanın son ödeme tarihi (boşsa müşterinin vadesi)', DUE_DATE),
      col('invoiceTotal', 'Fatura Toplamı (KDV dahil)', 'number', false, 'Opsiyonel: alacak takibinde kullanılan ödenecek tutar (boşsa satır tutarları)', ['ödenecek tutar', 'genel toplam', 'kdv dahil toplam', 'vergiler dahil toplam', 'fatura tutarı', 'payable amount', 'grand total'], { inTemplate: false }),
      col('customerTaxId', 'Müşteri Vergi No', 'text', false, 'Müşterinin VKN/TCKN', TAX_ID, { inTemplate: false }),
      col('region', 'Bölge', 'text', false, 'Müşterinin bölgesi', REGION, { inTemplate: false }),
      col('customerType', 'Müşteri Tipi', 'text', false, 'Bayi veya Mağaza', ['müşteri türü', 'kanal', 'customer type'], { inTemplate: false }),
      col('category', 'Kategori', 'text', false, 'Ürün kategorisi', CATEGORY, { inTemplate: false }),
      col('unitCost', 'Birim Maliyet (₺)', 'number', false, 'Ürün maliyeti', UNIT_COST, { inTemplate: false }),
    ],
  },
  {
    key: 'inventory',
    title: 'Stok',
    description: 'Bugünkü stok durumu: her ürünün her bölgedeki mevcut adedi.',
    nameHints: ['stok', 'stock', 'envanter', 'inventory', 'depo'],
    requireAny: [['sku', 'productName']],
    columns: [
      col('sku', 'Ürün Kodu (SKU)', 'text', false, 'Ürün kodu (veya Ürün Adı sütunu)', PRODUCT_CODE),
      col('productName', 'Ürün Adı', 'text', false, 'Ürün adı', PRODUCT_NAME, { inTemplate: false }),
      col('region', 'Bölge', 'text', false, 'Ör. İstanbul (boşsa "Merkez")', REGION),
      col('quantity', 'Mevcut Stok (adet)', 'number', true, 'Bugün elde olan miktar', ['stok', 'mevcut stok', 'stok miktarı', 'eldeki', 'kalan', 'miktar', 'adet', 'stock', 'on hand', 'quantity', 'qty']),
    ],
  },
  {
    key: 'expenses',
    title: 'Giderler',
    description:
      'İşletme giderleri. Kârlılık hesabında kullanılır. Departman ve proje girerseniz hangi departmanın veya ' +
      'projenin ne kadar harcadığı ve kârlılığı ayrıca gösterilir.',
    nameHints: ['gider', 'masraf', 'expense', 'harcama', 'maliyet'],
    columns: [
      col('expenseDate', 'Tarih', 'date', true, 'Gider tarihi', ['gider tarihi', 'fatura tarihi', 'ödeme tarihi', 'işlem tarihi', 'date']),
      col('category', 'Gider Türü', 'text', false, 'Ör. Personel, Malzeme, Lojistik, Kira (boşsa "Genel")', ['kategori', 'gider türü', 'gider kalemi', 'gider kategorisi', 'kalem', 'tür', 'hesap', 'category', 'type']),
      col('department', 'Departman', 'text', false, 'Opsiyonel: gideri yapan departman, ör. Üretim, Satış, Yönetim', DEPARTMENT),
      col('project', 'Proje', 'text', false, 'Opsiyonel: giderin ait olduğu proje veya iş', PROJECT),
      col('amount', 'Tutar (₺)', 'number', true, 'Gider tutarı', ['tutar', 'bedel', 'toplam', 'miktar', 'ödenen', 'amount', 'total', 'cost']),
      col('region', 'Bölge', 'text', false, 'Opsiyonel', REGION),
      col('description', 'Açıklama', 'text', false, 'Opsiyonel', ['not', 'notlar', 'detay', 'açıklamalar', 'description', 'note', 'memo'], { width: 36 }),
      col('supplier', 'Tedarikçi', 'text', false, 'Opsiyonel: borç takibi için kime ödeneceği', ['satıcı', 'tedarikçi adı', 'firma', 'cari', 'cari adı', 'cari ünvanı', 'cari hesap unvanı', 'supplier', 'vendor'], { width: 28 }),
      col('dueDate', 'Vade Tarihi', 'date', false, 'Opsiyonel: son ödeme tarihi', DUE_DATE),
      col('paidDate', 'Ödeme Tarihi', 'date', false, 'Opsiyonel: ödendiyse tarihi (boşsa ödenmemiş borç sayılır)', ['ödendiği tarih', 'ödeme yapıldı', 'paid date']),
      col('invoiceTotal', 'Fatura Toplamı (KDV dahil)', 'number', false, 'Opsiyonel: ödenecek tutar (borç takibi); boşsa Tutar', ['ödenecek tutar', 'genel toplam', 'kdv dahil toplam', 'fatura tutarı', 'payable amount', 'grand total'], { inTemplate: false }),
      col('invoiceNo', 'Fatura No', 'text', false, 'Opsiyonel: aynı fatura tekrar yüklenince eklenmez', ['fatura numarası', 'belge no', 'evrak no', 'fiş no', 'invoice no', 'invoice number'], { inTemplate: false }),
    ],
  },
  {
    key: 'payments',
    title: 'Tahsilatlar',
    description:
      'Müşterilerden alınan ödemeler (havale, nakit, çek, kart). Cari hesap bakiyesi ve vadesi geçen alacaklar bunlarla hesaplanır; ' +
      'ödemeler müşterinin en eski açık faturasından başlayarak kapatılır.',
    nameHints: ['tahsilat', 'payment', 'receipt', 'kasa', 'banka'],
    columns: [
      col('paymentDate', 'Tarih', 'date', true, 'Tahsilat tarihi', ['tahsilat tarihi', 'ödeme tarihi', 'işlem tarihi', 'valör', 'date', 'payment date']),
      col('customer', 'Müşteri', 'text', true, 'Ödemeyi yapan müşteri', CUSTOMER_NAME, { width: 30 }),
      col('amount', 'Tutar (₺)', 'number', true, 'Tahsil edilen tutar', ['tutar', 'tahsilat tutarı', 'ödeme tutarı', 'tahsil edilen', 'amount', 'paid']),
      col('method', 'Yöntem', 'text', false, 'Havale/EFT, Nakit, Çek, Senet, Kredi kartı', ['ödeme şekli', 'ödeme yöntemi', 'tahsilat türü', 'method', 'payment method'], { choices: ['Havale/EFT', 'Nakit', 'Çek', 'Senet', 'Kredi kartı'], width: 16 }),
      col('reference', 'Belge No', 'text', false, 'Opsiyonel: dekont, makbuz veya çek numarası', ['dekont no', 'makbuz no', 'çek no', 'referans', 'reference']),
      col('description', 'Açıklama', 'text', false, 'Opsiyonel', ['not', 'açıklamalar', 'description', 'note'], { width: 30 }),
    ],
  },
];

export const INSTRUCTIONS_TITLE = 'Nasıl Doldurulur';

/** Şablonda gösterilen sütunlar */
export const templateColumns = (spec: SheetSpec) => spec.columns.filter((c) => c.inTemplate !== false);

/** Bir sayfa türünün zorunlu alanlarından eşleşmemiş olanları kullanıcıya uygun metinle döner. */
export function missingRequirements(spec: SheetSpec, mapped: Set<string>): string[] {
  const label = (key: string) => spec.columns.find((c) => c.key === key)!.header.replace(/\s*\(.*\)\s*$/, '');
  const missing = spec.columns.filter((c) => c.required && !mapped.has(c.key)).map((c) => label(c.key));
  for (const group of spec.requireAny ?? []) {
    if (!group.some((key) => mapped.has(key))) missing.push(group.map(label).join(' veya '));
  }
  return missing;
}
