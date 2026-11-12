/**
 * Senaryo: temizlik, hijyen ve kağıt ürünleri dağıtan bir B2B toptancı.
 * 5 bölge deposu, 12 ürün, 30 bayi/mağaza müşterisi. Tüm isimler kurgusaldır.
 */
import type { CustomerType } from '../repositories/customerRepository.js';

export const REGIONS = [
  { id: 1, name: 'İstanbul' },
  { id: 2, name: 'Ankara' },
  { id: 3, name: 'İzmir' },
  { id: 4, name: 'Bursa' },
  { id: 5, name: 'Antalya' },
] as const;

export interface ProductSeed {
  id: number;
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  listPrice: number;
  /** Boyut katsayısı 1 olan bir müşterinin günlük ortalama tüketimi (adet). */
  dailyDemand: number;
}

export const PRODUCTS: readonly ProductSeed[] = [
  { id: 1, sku: 'TMZ-001', name: 'Yüzey Temizleyici 5L', category: 'Temizlik', unitCost: 92, listPrice: 145, dailyDemand: 4.8 },
  { id: 2, sku: 'TMZ-002', name: 'Bulaşık Deterjanı 5L', category: 'Temizlik', unitCost: 104, listPrice: 165, dailyDemand: 4.2 },
  { id: 3, sku: 'TMZ-003', name: 'Çamaşır Suyu 4L', category: 'Temizlik', unitCost: 36, listPrice: 58, dailyDemand: 6.6 },
  { id: 4, sku: 'TMZ-004', name: 'Endüstriyel Yağ Çözücü 5L', category: 'Temizlik', unitCost: 178, listPrice: 289, dailyDemand: 2.7 },
  { id: 5, sku: 'HJY-001', name: 'El Dezenfektanı 1L', category: 'Hijyen', unitCost: 52, listPrice: 94, dailyDemand: 5.4 },
  { id: 6, sku: 'HJY-002', name: 'Sıvı Sabun 5L', category: 'Hijyen', unitCost: 83, listPrice: 132, dailyDemand: 3.9 },
  { id: 7, sku: 'KAG-001', name: "Kağıt Havlu 6'lı", category: 'Kağıt', unitCost: 58, listPrice: 89, dailyDemand: 7.2 },
  { id: 8, sku: 'KAG-002', name: "Tuvalet Kağıdı 32'li", category: 'Kağıt', unitCost: 165, listPrice: 239, dailyDemand: 4.5 },
  { id: 9, sku: 'KAG-003', name: 'Peçete 24x100', category: 'Kağıt', unitCost: 72, listPrice: 112, dailyDemand: 3.6 },
  { id: 10, sku: 'AMB-001', name: 'Jumbo Çöp Poşeti 10 Rulo', category: 'Ambalaj', unitCost: 46, listPrice: 71, dailyDemand: 5.1 },
  { id: 11, sku: 'AMB-002', name: 'Streç Film 30cm', category: 'Ambalaj', unitCost: 86, listPrice: 90, dailyDemand: 2.4 },
  { id: 12, sku: 'EKP-001', name: "Mikrofiber Bez 10'lu", category: 'Ekipman', unitCost: 63, listPrice: 108, dailyDemand: 2.1 },
];

export interface EmployeeSeed {
  id: number;
  fullName: string;
  role: string;
  regionId: number;
  monthlySalary: number;
  hireDate: string;
}

export const EMPLOYEES: readonly EmployeeSeed[] = [
  { id: 1, fullName: 'Selin Aydın', role: 'Genel Müdür', regionId: 1, monthlySalary: 185_000, hireDate: '2019-03-01' },
  { id: 2, fullName: 'Murat Kaya', role: 'Operasyon Müdürü', regionId: 1, monthlySalary: 120_000, hireDate: '2020-01-15' },
  { id: 3, fullName: 'Elif Demir', role: 'Satış Temsilcisi', regionId: 1, monthlySalary: 68_000, hireDate: '2021-05-10' },
  { id: 4, fullName: 'Burak Şahin', role: 'Satış Temsilcisi', regionId: 1, monthlySalary: 64_000, hireDate: '2022-02-01' },
  { id: 5, fullName: 'Zeynep Arslan', role: 'Satış Temsilcisi', regionId: 2, monthlySalary: 62_000, hireDate: '2021-09-01' },
  { id: 6, fullName: 'Emre Yıldız', role: 'Satış Temsilcisi', regionId: 3, monthlySalary: 62_000, hireDate: '2020-11-16' },
  { id: 7, fullName: 'Ayşe Çelik', role: 'Satış Temsilcisi', regionId: 4, monthlySalary: 58_000, hireDate: '2023-03-01' },
  { id: 8, fullName: 'Can Öztürk', role: 'Satış Temsilcisi', regionId: 5, monthlySalary: 58_000, hireDate: '2022-06-13' },
  { id: 9, fullName: 'Hakan Koç', role: 'Depo Sorumlusu', regionId: 1, monthlySalary: 52_000, hireDate: '2021-01-04' },
  { id: 10, fullName: 'Gamze Polat', role: 'Depo Sorumlusu', regionId: 2, monthlySalary: 48_000, hireDate: '2022-08-22' },
  { id: 11, fullName: 'Oğuz Erdem', role: 'Lojistik Koordinatörü', regionId: 1, monthlySalary: 60_000, hireDate: '2020-06-01' },
  { id: 12, fullName: 'Deniz Kurt', role: 'Muhasebe Uzmanı', regionId: 1, monthlySalary: 65_000, hireDate: '2021-03-15' },
];

export interface CustomerSeed {
  id: number;
  name: string;
  customerType: CustomerType;
  regionId: number;
}

export const CUSTOMERS: readonly CustomerSeed[] = [
  // İstanbul
  { id: 1, name: 'Marmara Temizlik Dağıtım', customerType: 'Bayi', regionId: 1 },
  { id: 2, name: 'Boğaziçi Hijyen Ltd.', customerType: 'Bayi', regionId: 1 },
  { id: 3, name: 'Kadıköy Market Zinciri', customerType: 'Mağaza', regionId: 1 },
  { id: 4, name: 'Beylikdüzü Toptan', customerType: 'Bayi', regionId: 1 },
  { id: 5, name: 'Ataşehir Ofis Tedarik', customerType: 'Mağaza', regionId: 1 },
  { id: 6, name: 'Şişli Otel Malzemeleri', customerType: 'Mağaza', regionId: 1 },
  { id: 7, name: 'Pendik Endüstri Tedarik', customerType: 'Bayi', regionId: 1 },
  { id: 8, name: 'Üsküdar Temizlik Market', customerType: 'Mağaza', regionId: 1 },
  // Ankara
  { id: 9, name: 'Başkent Hijyen Dağıtım', customerType: 'Bayi', regionId: 2 },
  { id: 10, name: 'Çankaya Ofis Market', customerType: 'Mağaza', regionId: 2 },
  { id: 11, name: 'Ostim Endüstriyel Tedarik', customerType: 'Bayi', regionId: 2 },
  { id: 12, name: 'Keçiören Toptan Temizlik', customerType: 'Bayi', regionId: 2 },
  { id: 13, name: 'Kızılay Kırtasiye & Temizlik', customerType: 'Mağaza', regionId: 2 },
  { id: 14, name: 'Etimesgut Market', customerType: 'Mağaza', regionId: 2 },
  // İzmir
  { id: 15, name: 'Ege Temizlik Bayi', customerType: 'Bayi', regionId: 3 },
  { id: 16, name: 'Karşıyaka Hijyen Market', customerType: 'Mağaza', regionId: 3 },
  { id: 17, name: 'Bornova Toptan Dağıtım', customerType: 'Bayi', regionId: 3 },
  { id: 18, name: 'Alsancak Otel Tedarik', customerType: 'Mağaza', regionId: 3 },
  { id: 19, name: 'Çiğli Sanayi Malzemeleri', customerType: 'Bayi', regionId: 3 },
  { id: 20, name: 'Buca Temizlik Market', customerType: 'Mağaza', regionId: 3 },
  // Bursa
  { id: 21, name: 'Uludağ Temizlik Dağıtım', customerType: 'Bayi', regionId: 4 },
  { id: 22, name: 'Nilüfer Hijyen Market', customerType: 'Mağaza', regionId: 4 },
  { id: 23, name: 'Osmangazi Toptan', customerType: 'Bayi', regionId: 4 },
  { id: 24, name: 'Mudanya Otel Tedarik', customerType: 'Mağaza', regionId: 4 },
  { id: 25, name: 'Gemlik Sanayi Tedarik', customerType: 'Bayi', regionId: 4 },
  // Antalya
  { id: 26, name: 'Akdeniz Hijyen Dağıtım', customerType: 'Bayi', regionId: 5 },
  { id: 27, name: 'Lara Otel Tedarik', customerType: 'Mağaza', regionId: 5 },
  { id: 28, name: 'Muratpaşa Temizlik Market', customerType: 'Mağaza', regionId: 5 },
  { id: 29, name: 'Kepez Toptan', customerType: 'Bayi', regionId: 5 },
  { id: 30, name: 'Alanya Turizm Tedarik', customerType: 'Bayi', regionId: 5 },
];

/** Bölge başına kira (₺/ay). */
export const WAREHOUSE_RENT: Readonly<Record<number, number>> = {
  1: 110_000,
  2: 60_000,
  3: 55_000,
  4: 42_000,
  5: 38_000,
};
