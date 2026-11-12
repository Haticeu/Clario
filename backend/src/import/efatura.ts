import JSZip from 'jszip';
import type { Grid } from './mapping.js';

/**
 * e-Fatura / e-Arşiv (GİB UBL-TR XML) okuyucu. Tek XML veya çok sayıda XML içeren ZIP (GİB portalı, entegratör
 * ya da ERP dışa aktarımı) kabul edilir. Faturalar Excel aktarımındaki sayfalara dönüştürülür; böylece sütun
 * eşleştirme, kontrol raporu ve mükerrer kayıt koruması aynen çalışır:
 *   - Giden faturalar (satıcı = firmamız) → "e-Fatura Satışlar" (fatura no, müşteri + VKN, kalemler, vade, KDV dahil toplam)
 *   - Gelen faturalar (alıcı = firmamız)  → "e-Fatura Alışlar (Giderler)" (tedarikçi, KDV hariç tutar, vade, fatura no)
 * Firmamız: ayarlardaki vergi numarası; yoksa her faturada (satıcı veya alıcı olarak) geçen vergi numarası.
 */

export interface EInvoiceParty {
  taxId: string | null;
  name: string;
  city: string | null;
}

export interface EInvoiceLine {
  code: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface EInvoice {
  id: string;
  uuid: string | null;
  issueDate: string;
  typeCode: string;
  currency: string;
  /** Yabancı para faturada belgedeki kur (1 birim = ? TRY) */
  exchangeRate: number | null;
  dueDate: string | null;
  supplier: EInvoiceParty;
  customer: EInvoiceParty;
  taxExclusive: number;
  payable: number;
  lines: EInvoiceLine[];
}

export interface EInvoiceContext {
  /** Ayarlardaki firma vergi numarası (VKN/TCKN) */
  companyTaxId?: string | null;
  /** Verilerin para birimi; farklı para birimli faturalar belgedeki kurla buna çevrilir */
  baseCurrency?: string;
}

export interface EInvoiceResult {
  grids: Grid[];
  invoices: EInvoice[];
  /** Tespit edilen veya ayarlardan alınan firma vergi numarası */
  companyTaxId: string | null;
}

const MAX_FILES = 20_000;

/** Ad alanı öneklerini atar: <cbc:ID> → <ID>, </cac:Party> → </Party> */
const stripPrefixes = (xml: string) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1').replace(/\s[A-Za-z_][\w.-]*:([A-Za-z_][\w.-]*=)/g, ' $1');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e] ?? m),
    )
    .trim();

/** İlk <name> öğesinin içeriği (iç içe aynı adlı öğe yoksa doğru çalışır; UBL'de başlık alanları için yeterli) */
function first(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]!) : null;
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'g'))].map((m) => m[0]);
}

function remove(xml: string, names: string[]): string {
  return names.reduce((text, name) => text.replace(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, 'g'), ''), xml);
}

const num = (text: string | null) => {
  if (!text) return 0;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
};

function party(xml: string | null): EInvoiceParty {
  if (!xml) return { taxId: null, name: 'Bilinmeyen', city: null };
  let taxId: string | null = null;
  for (const identification of blocks(xml, 'PartyIdentification')) {
    const match = identification.match(/<ID[^>]*schemeID="(VKN|TCKN)"[^>]*>([^<]+)<\/ID>/i);
    if (match) {
      taxId = match[2]!.replace(/\D/g, '');
      break;
    }
  }
  const person = first(xml, 'Person');
  const personName = person ? [first(person, 'FirstName'), first(person, 'FamilyName')].filter(Boolean).join(' ') : '';
  const partyName = first(first(xml, 'PartyName') ?? '', 'Name');
  return {
    taxId,
    name: (partyName || personName || 'Bilinmeyen').replace(/\s+/g, ' ').slice(0, 120),
    city: first(first(xml, 'PostalAddress') ?? '', 'CityName'),
  };
}

/** Tek bir UBL-TR faturasını okur; fatura değilse null */
export function parseEInvoice(source: string): EInvoice | null {
  const xml = stripPrefixes(source.replace(/^﻿/, ''));
  if (!/<Invoice[\s>]/.test(xml)) return null;
  const supplier = party(first(xml, 'AccountingSupplierParty'));
  const customer = party(first(xml, 'AccountingCustomerParty'));
  const lines = blocks(xml, 'InvoiceLine').map((line) => {
    const item = first(line, 'Item') ?? '';
    const quantity = num(first(line, 'InvoicedQuantity'));
    const lineTotal = num(first(line, 'LineExtensionAmount'));
    const price = num(first(first(line, 'Price') ?? '', 'PriceAmount'));
    return {
      code: first(first(item, 'SellersItemIdentification') ?? '', 'ID'),
      name: (first(item, 'Name') ?? first(line, 'Note') ?? 'Kalem').replace(/\s+/g, ' ').slice(0, 120),
      quantity,
      // İndirimler satır tutarına yansır: birim fiyat = satır tutarı ÷ miktar
      unitPrice: quantity > 0 ? Math.round((lineTotal / quantity) * 10_000) / 10_000 : price,
      lineTotal,
    };
  });
  // Başlık alanları: satır, taraf, imza ve ek bloklar çıkarıldıktan sonra okunur (iç içe ID'ler karışmasın)
  const header = remove(xml, [
    'UBLExtensions', 'Signature', 'AccountingSupplierParty', 'AccountingCustomerParty', 'InvoiceLine', 'AdditionalDocumentReference',
    'OrderReference', 'DespatchDocumentReference', 'BillingReference', 'Delivery', 'TaxTotal', 'WithholdingTaxTotal', 'AllowanceCharge',
    'BuyerCustomerParty', 'SellerSupplierParty', 'TaxRepresentativeParty', 'OriginatorDocumentReference',
  ]);
  const totals = first(header, 'LegalMonetaryTotal') ?? '';
  const rate = num(first(first(header, 'PricingExchangeRate') ?? '', 'CalculationRate'));
  const paymentMeans = blocks(header, 'PaymentMeans').map((b) => first(b, 'PaymentDueDate')).find(Boolean) ?? null;
  const id = first(header, 'ID');
  const issueDate = first(header, 'IssueDate');
  if (!id || !issueDate) return null;
  return {
    id,
    uuid: first(header, 'UUID'),
    issueDate,
    typeCode: (first(header, 'InvoiceTypeCode') ?? 'SATIS').toUpperCase(),
    currency: (first(header, 'DocumentCurrencyCode') ?? 'TRY').toUpperCase(),
    exchangeRate: rate > 0 ? rate : null,
    dueDate: paymentMeans ?? first(first(header, 'PaymentTerms') ?? '', 'PaymentDueDate'),
    supplier,
    customer,
    taxExclusive: num(first(totals, 'TaxExclusiveAmount')) || num(first(totals, 'LineExtensionAmount')),
    payable: num(first(totals, 'PayableAmount')) || num(first(totals, 'TaxInclusiveAmount')),
    lines,
  };
}

const isZip = (buffer: Buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

/** ZIP bir Excel dosyası mı (xlsx de ZIP'tir) */
export async function isXlsxZip(buffer: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('[Content_Types].xml') !== null && Object.keys(zip.files).some((name) => name.startsWith('xl/'));
}

/** Dosya e-Fatura XML'i (veya XML içeren ZIP) mi */
export async function looksLikeEInvoice(buffer: Buffer): Promise<boolean> {
  if (isZip(buffer)) {
    try {
      return !(await isXlsxZip(buffer));
    } catch {
      return false;
    }
  }
  const head = buffer.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  return head.startsWith('<') && /Invoice[\s>]/.test(head + buffer.subarray(4096, 65_536).toString('utf8'));
}

/** ZIP içindeki XML'leri (iç içe ZIP'ler dahil) toplar */
async function collectXml(buffer: Buffer, out: string[], depth = 0): Promise<void> {
  if (!isZip(buffer)) {
    out.push(buffer.toString('utf8'));
    return;
  }
  if (depth > 2) return;
  const zip = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || out.length >= MAX_FILES) continue;
    const name = entry.name.toLowerCase();
    if (name.endsWith('.xml')) out.push(await entry.async('string'));
    else if (name.endsWith('.zip')) await collectXml(Buffer.from(await entry.async('uint8array')), out, depth + 1);
  }
}

/** Faturaların hepsinde (satıcı veya alıcı olarak) geçen vergi numarası = firmamız */
function detectCompany(invoices: EInvoice[]): string | null {
  const counts = new Map<string, number>();
  for (const invoice of invoices) {
    for (const id of new Set([invoice.supplier.taxId, invoice.customer.taxId])) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const everywhere = [...counts].filter(([, n]) => n === invoices.length).map(([id]) => id);
  return everywhere.length === 1 ? everywhere[0]! : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function readEInvoices(buffer: Buffer, context: EInvoiceContext = {}): Promise<EInvoiceResult> {
  const sources: string[] = [];
  await collectXml(buffer, sources);
  const seen = new Set<string>();
  const invoices: EInvoice[] = [];
  for (const source of sources) {
    const invoice = parseEInvoice(source);
    if (!invoice) continue;
    // Aynı fatura birden fazla kez (ör. hem ZIP'te hem iç ZIP'te) geçebilir
    const key = invoice.uuid ?? `${invoice.id}|${invoice.supplier.taxId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    invoices.push(invoice);
  }

  // Firmamız: ayar > tüm faturalarda geçen VKN > (tek fatura) satıcı
  const companyTaxId = context.companyTaxId || (invoices.length > 1 ? detectCompany(invoices) : null) || invoices[0]?.supplier.taxId || null;
  const base = (context.baseCurrency ?? 'TRY').toUpperCase();
  // Yabancı para birimli fatura: belgedeki kur TRY'ye çevirir (veriler TRY ise); aksi halde olduğu gibi
  const factor = (invoice: EInvoice) => (invoice.currency !== base && base === 'TRY' && invoice.exchangeRate ? invoice.exchangeRate : 1);

  const salesRows: unknown[][] = [];
  const purchaseRows: unknown[][] = [];
  for (const invoice of invoices) {
    const f = factor(invoice);
    const isReturn = invoice.typeCode === 'IADE';
    const outgoing = invoice.supplier.taxId !== null && invoice.supplier.taxId === companyTaxId;
    if (outgoing || (!companyTaxId && !isReturn)) {
      for (const line of invoice.lines) {
        salesRows.push([
          invoice.id,
          invoice.issueDate,
          invoice.customer.name,
          invoice.customer.taxId,
          invoice.customer.city,
          line.code,
          line.name,
          // İade faturası satış analizine eksi adetle girer (aktarımda atlanır ve bildirilir)
          isReturn ? -line.quantity : line.quantity,
          round2(line.unitPrice * f),
          round2(line.lineTotal * f),
          invoice.dueDate,
          round2(invoice.payable * f),
        ]);
      }
    } else {
      // Alış iadesi gider değildir (tedarikçiye geri gönderim); gider olarak alınmaz
      if (isReturn) continue;
      purchaseRows.push([
        invoice.issueDate,
        'Alış faturası',
        round2(invoice.taxExclusive * f),
        round2(invoice.payable * f),
        invoice.lines.map((l) => l.name).slice(0, 3).join(', ').slice(0, 280) || null,
        invoice.supplier.name,
        invoice.dueDate,
        invoice.id,
      ]);
    }
  }

  const grids: Grid[] = [];
  if (salesRows.length > 0) {
    grids.push({
      name: 'e-Fatura Satışlar',
      rows: [
        ['Sipariş No', 'Tarih', 'Müşteri', 'Müşteri Vergi No', 'Bölge', 'Ürün Kodu (SKU)', 'Ürün Adı', 'Adet', 'Birim Satış Fiyatı (₺)', 'Tutar (₺)', 'Vade Tarihi', 'Fatura Toplamı (KDV dahil)'],
        ...salesRows,
      ],
    });
  }
  if (purchaseRows.length > 0) {
    grids.push({
      name: 'e-Fatura Alışlar (Giderler)',
      rows: [['Tarih', 'Gider Türü', 'Tutar (₺)', 'Fatura Toplamı (KDV dahil)', 'Açıklama', 'Tedarikçi', 'Vade Tarihi', 'Fatura No'], ...purchaseRows],
    });
  }
  return { grids, invoices, companyTaxId };
}
