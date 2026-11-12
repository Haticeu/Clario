/**
 * Kullanıcının kendi tablolarını anlama: dosyayı okur, başlık satırını bulur, sütunları
 * anlamlarına göre alanlara eşler ve her sayfanın hangi veri türü olduğunu tahmin eder.
 *
 * Eşleştirme kullanıcıya gösterilir ve düzeltilebilir (ImportMapping); içe aktarma her zaman
 * onaylanmış eşleştirmeyle yapılır.
 */
import ExcelJS from 'exceljs';
import { looksLikeEInvoice, readEInvoices, type EInvoiceContext } from './efatura.js';
import { matchKey } from '../data/validation.js';
import { INSTRUCTIONS_TITLE, missingRequirements, SHEETS, type SheetKey, type SheetSpec } from './sheets.js';

// ── Dosyayı tablolara (grid) çevirme ────────────────────────────────────────

export interface Grid {
  name: string;
  /** Satırlar (0 tabanlı); her hücre sade bir değerdir: string | number | Date | boolean | null */
  rows: unknown[][];
}

export class WorkbookReadError extends Error {}

function plainValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== 'object') return typeof value === 'string' ? value.trim() : value;
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
  if ('result' in value) return plainValue(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text).trim();
  return null;
}

async function readXlsx(buffer: Buffer): Promise<Grid[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new WorkbookReadError('Excel dosyası okunamadı. Dosya bozuk veya şifreli olabilir; Excel\'de açıp yeniden kaydetmeyi deneyin.');
  }
  return workbook.worksheets.map((sheet) => {
    const rows: unknown[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: unknown[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(plainValue(row.getCell(c).value));
      rows.push(cells);
    }
    return { name: sheet.name, rows };
  });
}

/** UTF-8 (BOM'lu/BOM'suz) veya Türkçe Windows kodlamasındaki metni çözer. */
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1254').decode(buffer);
  }
}

/** Basit ve standart (RFC 4180) CSV ayrıştırıcı; ayraç (; , sekme) ilk satırdan tahmin edilir. */
function readCsv(buffer: Buffer): Grid[] {
  const text = decodeText(buffer).replace(/\r\n?/g, '\n');
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const delimiter = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;

  const rows: unknown[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      rows.push(row.map((v) => (v === '' ? null : v)));
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    rows.push(row.map((v) => (v === '' ? null : v)));
  }
  return [{ name: 'CSV', rows }];
}

/** .xlsx veya .csv dosyasını tablolara çevirir; biçim dosya içeriğinden anlaşılır. */
export async function readGrids(buffer: Buffer, context: EInvoiceContext = {}): Promise<Grid[]> {
  // e-Fatura / e-Arşiv: UBL-TR XML veya XML içeren ZIP → satış ve alış sayfaları
  if (await looksLikeEInvoice(buffer)) {
    const { grids } = await readEInvoices(buffer, context);
    if (grids.length === 0) throw new WorkbookReadError('Dosyada okunabilir e-Fatura bulunamadı. GİB UBL-TR biçimindeki .xml dosyalarını veya bunları içeren .zip dosyasını yükleyin.');
    return grids;
  }
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return readXlsx(buffer); // ZIP → .xlsx
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0xd0cf11e0) {
    throw new WorkbookReadError('Eski Excel biçimi (.xls) desteklenmiyor. Dosyayı Excel\'de açıp "Farklı Kaydet → Excel Çalışma Kitabı (.xlsx)" ile kaydedin.');
  }
  const sample = buffer.subarray(0, 2048);
  if (sample.includes(0)) throw new WorkbookReadError('Dosya okunamadı. Lütfen .xlsx (Excel), .csv veya e-Fatura (.xml / .zip) dosyası yükleyin.');
  const grids = readCsv(buffer);
  if (grids[0]!.rows.length === 0 || grids[0]!.rows.every((r) => r.length < 2)) {
    throw new WorkbookReadError('Dosya okunamadı. Lütfen .xlsx (Excel), .csv veya e-Fatura (.xml / .zip) dosyası yükleyin.');
  }
  return grids;
}

// ── Başlık ↔ alan eşleştirme ─────────────────────────────────────────────────

function normalizeHeader(value: unknown): string {
  return matchKey(String(value ?? ''))
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/₺|\btl\b|\btry\b|\busd\b|\beur\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Başlığın bir eş anlamlıya ne kadar benzediği (0–100). Türkçe ekler için önek eşleşmesi yapılır. */
function similarity(header: string, synonym: string): number {
  if (!header || !synonym) return 0;
  if (header === synonym) return 100;
  const h = header.split(' ');
  const s = synonym.split(' ');
  // Eş anlamlının kelimeleri başlıkta sırayla geçiyor mu? ("satış tutarı" ⊂ "net satış tutarı")
  for (let start = 0; start + s.length <= h.length; start++) {
    let exact = true;
    let prefix = true;
    for (let i = 0; i < s.length; i++) {
      const token = h[start + i]!;
      if (token !== s[i]) exact = false;
      if (!(token === s[i] || (s[i]!.length >= 3 && token.startsWith(s[i]!)))) prefix = false;
    }
    if (exact) return s.length > 1 ? 85 : 72 - Math.min(h.length - 1, 3) * 2;
    if (prefix) return s.length > 1 ? 78 : 62;
  }
  return 0;
}

const MIN_SCORE = 60;

function fieldScore(spec: SheetSpec, key: string, header: string): number {
  const column = spec.columns.find((c) => c.key === key)!;
  return Math.max(...column.synonyms.map((synonym) => similarity(header, normalizeHeader(synonym))));
}

const TOTAL_ROW = /^(genel\s+|ara\s+)?(toplam|total|grand total|subtotal)\b/i;

function looksLikeDate(value: unknown): boolean {
  if (value instanceof Date) return true;
  return typeof value === 'string' && /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/.test(value.trim());
}

/** Bir sayfa türü için başlıkları alanlara açgözlü (en yüksek puan önce) eşler. */
function assignColumns(spec: SheetSpec, headers: string[], dataRows: unknown[][]): { columns: Map<number, string>; score: number } {
  const pairs: { index: number; key: string; score: number }[] = [];
  headers.forEach((header, index) => {
    if (!header) return;
    for (const column of spec.columns) {
      const score = fieldScore(spec, column.key, header);
      if (score >= MIN_SCORE) pairs.push({ index, key: column.key, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);

  const columns = new Map<number, string>();
  const usedKeys = new Set<string>();
  let score = 0;
  for (const pair of pairs) {
    if (columns.has(pair.index) || usedKeys.has(pair.key)) continue;
    columns.set(pair.index, pair.key);
    usedKeys.add(pair.key);
    score += pair.score;
  }

  // Başlıktan anlaşılamayan tarih alanını içerikten bul (sütun değerlerinin çoğu tarihse)
  for (const column of spec.columns.filter((c) => c.type === 'date' && !usedKeys.has(c.key))) {
    const candidate = headers.findIndex((_, index) => {
      if (columns.has(index)) return false;
      const values = dataRows.slice(0, 30).map((r) => r[index]).filter((v) => v !== null && v !== '');
      return values.length >= 2 && values.filter(looksLikeDate).length / values.length >= 0.8;
    });
    if (candidate >= 0) {
      columns.set(candidate, column.key);
      usedKeys.add(column.key);
      score += 55;
    }
  }
  return { columns, score };
}

/** İlk 20 satır içinde en çok tanınan başlığa sahip satır başlık satırıdır. */
function findHeaderRow(grid: Grid): number {
  let best = { row: -1, count: 0 };
  for (let r = 0; r < Math.min(grid.rows.length, 20); r++) {
    const headers = grid.rows[r]!.map(normalizeHeader);
    let count = 0;
    for (const header of headers) {
      if (header && SHEETS.some((spec) => spec.columns.some((c) => fieldScore(spec, c.key, header) >= MIN_SCORE))) count++;
    }
    if (count > best.count) best = { row: r, count };
  }
  if (best.count >= 2) return best.row;
  const firstNonEmpty = grid.rows.findIndex((row) => row.filter((v) => v !== null && v !== '').length >= 2);
  return Math.max(firstNonEmpty, 0);
}

// ── Analiz (kullanıcıya gösterilen eşleştirme önerisi) ──────────────────────

export interface ColumnAnalysis {
  index: number;
  header: string;
  samples: string[];
}

export interface SheetAnalysis {
  name: string;
  /** Tahmin edilen veri türü; tanınamadıysa null */
  type: SheetKey | null;
  /** 1 tabanlı başlık satırı numarası */
  headerRow: number;
  rowCount: number;
  columns: ColumnAnalysis[];
  /** Her veri türü için önerilen eşleştirme: sütun sırası (0 tabanlı) → alan */
  suggestions: Record<SheetKey, Record<string, string>>;
}

export interface ImportMapping {
  sheets: { name: string; type: SheetKey | null; headerRow: number; columns: Record<string, string> }[];
}

function display(value: unknown): string {
  if (value instanceof Date) {
    const d = value;
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }
  return String(value ?? '').slice(0, 40);
}

export function analyzeGrids(grids: Grid[]): SheetAnalysis[] {
  const analyses: SheetAnalysis[] = [];
  for (const grid of grids) {
    if (matchKey(grid.name) === matchKey(INSTRUCTIONS_TITLE)) continue;
    const headerIndex = findHeaderRow(grid);
    const headerCells = grid.rows[headerIndex] ?? [];
    const dataRows = grid.rows
      .slice(headerIndex + 1)
      .filter((row) => row.some((v) => v !== null && v !== '') && !row.some((v) => typeof v === 'string' && TOTAL_ROW.test(v)));
    if (headerCells.every((v) => v === null || v === '') && dataRows.length === 0) continue;

    const width = Math.max(headerCells.length, ...dataRows.slice(0, 50).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => normalizeHeader(headerCells[i]));
    const columns: ColumnAnalysis[] = [];
    for (let i = 0; i < width; i++) {
      const samples = dataRows.map((r) => r[i]).filter((v) => v !== null && v !== '').slice(0, 3).map(display);
      if (!headerCells[i] && samples.length === 0) continue;
      columns.push({ index: i, header: String(headerCells[i] ?? `Sütun ${i + 1}`), samples });
    }

    const suggestions = {} as SheetAnalysis['suggestions'];
    let best: { type: SheetKey; score: number } | null = null;
    const sheetName = matchKey(grid.name);
    for (const spec of SHEETS) {
      const { columns: assigned, score } = assignColumns(spec, headers, dataRows);
      suggestions[spec.key] = Object.fromEntries([...assigned].map(([index, key]) => [String(index), key]));
      const nameBonus = spec.nameHints.some((hint) => sheetName.includes(matchKey(hint))) ? 60 : 0;
      const complete = missingRequirements(spec, new Set(assigned.values())).length === 0;
      // Eksiksiz eşleşen türler önce; sonra puan
      const total = score + nameBonus + (complete ? 1000 : 0);
      if (assigned.size > 0 && (complete || nameBonus > 0) && (!best || total > best.score)) best = { type: spec.key, score: total };
    }

    analyses.push({ name: grid.name, type: best?.type ?? null, headerRow: headerIndex + 1, rowCount: dataRows.length, columns, suggestions });
  }
  return analyses;
}

/** Analizden otomatik eşleştirme (kullanıcı değiştirmediyse kullanılır). */
export function defaultMapping(analyses: SheetAnalysis[]): ImportMapping {
  return {
    sheets: analyses.map((a) => ({
      name: a.name,
      type: a.type,
      headerRow: a.headerRow,
      columns: a.type ? a.suggestions[a.type] : {},
    })),
  };
}

// ── Eşleştirmeyi uygulama ────────────────────────────────────────────────────

export interface ParsedRow {
  /** Dosyadaki satır numarası (hata mesajlarında gösterilir) */
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface ParsedSheet {
  spec: SheetSpec;
  /** Kullanıcının dosyasındaki sayfa adı */
  sheetName: string;
  rows: ParsedRow[];
  /** Eşleştirilmemiş zorunlu alanlar */
  missing: string[];
  /** Atlanan "Toplam" satırları */
  skippedTotals: number;
  /** Boş tarih/müşteri hücresi üstteki satırdan tamamlanan satır sayısı */
  filledRows: number;
}

const isBlank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * Gruplanmış tablolar: tarih veya müşteri yalnızca grubun ilk satırında yazılıp alttaki satırlar boş
 * bırakılmışsa (veya hücreler birleştirilmişse), boş hücreler üstteki satırdan tamamlanır.
 * Yalnızca ürünü olan (gerçek satış kalemi) satırlara uygulanır.
 */
function fillDownSales(rows: ParsedRow[]): number {
  const last: Record<string, unknown> = {};
  let filled = 0;
  for (const row of rows) {
    const v = row.values;
    const isItem = !isBlank(v.sku) || !isBlank(v.productName);
    if (isItem) {
      const noDate = isBlank(v.orderDate);
      const noCustomer = isBlank(v.customer);
      // İkisi birden boşsa satır açıkça bir grubun devamıdır: sipariş bilgileri de devralınır
      const keys = noDate && noCustomer ? ['orderDate', 'customer', 'orderNo', 'region', 'customerType'] : ['orderDate', 'customer'];
      let changed = false;
      for (const key of keys) {
        if (key in v && isBlank(v[key]) && !isBlank(last[key])) {
          v[key] = last[key];
          changed = true;
        }
      }
      if (changed) filled++;
    }
    for (const key of ['orderDate', 'customer', 'orderNo', 'region', 'customerType']) {
      if (!isBlank(v[key])) last[key] = v[key];
    }
  }
  return filled;
}

export function applyMapping(grids: Grid[], mapping: ImportMapping): ParsedSheet[] {
  const parsed: ParsedSheet[] = [];
  for (const sheet of mapping.sheets) {
    if (!sheet.type) continue;
    const spec = SHEETS.find((s) => s.key === sheet.type);
    const grid = grids.find((g) => g.name === sheet.name);
    if (!spec || !grid) continue;

    const columns = Object.entries(sheet.columns)
      .map(([index, key]) => [Number(index), key] as const)
      .filter(([index, key]) => Number.isInteger(index) && spec.columns.some((c) => c.key === key));
    const headerIndex = Math.max(0, Math.min(Number(sheet.headerRow) - 1 || 0, grid.rows.length));

    const rows: ParsedRow[] = [];
    let skippedTotals = 0;
    grid.rows.slice(headerIndex + 1).forEach((cells, offset) => {
      if (!cells.some((v) => v !== null && v !== '')) return;
      if (cells.some((v) => typeof v === 'string' && TOTAL_ROW.test(v))) {
        skippedTotals++;
        return;
      }
      const values: Record<string, unknown> = {};
      for (const [index, key] of columns) values[key] = cells[index] ?? null;
      if (Object.values(values).every((v) => v === null || v === '')) return;
      rows.push({ rowNumber: headerIndex + 2 + offset, values });
    });

    parsed.push({
      spec,
      sheetName: sheet.name,
      rows,
      missing: missingRequirements(spec, new Set(columns.map(([, key]) => key))),
      skippedTotals,
      filledRows: spec.key === 'sales' ? fillDownSales(rows) : 0,
    });
  }
  return parsed;
}

/** Eşleştirme verilmezse otomatik tahminle okur. */
export async function parseUpload(buffer: Buffer, mapping?: ImportMapping, context: EInvoiceContext = {}): Promise<ParsedSheet[]> {
  const grids = await readGrids(buffer, context);
  return applyMapping(grids, mapping ?? defaultMapping(analyzeGrids(grids)));
}
