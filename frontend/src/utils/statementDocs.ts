import { getStatement, statementExcelPath } from '../api'
import type { ReportBreakdownRow, Statement } from '../types'
import { downloadApiFile, saveBlob } from './download'

/**
 * Raporun PDF ve Word (DOCX) dosyaları tarayıcıda / telefonda üretilir (sunucuya gerek yok). Kütüphaneler
 * yalnızca indirme sırasında yüklenir. Ekstrenin Excel'i sunucuda üretilir (bkz. statementExcelPath).
 */

const LOCALE = 'tr-TR'
const MAX_ORDER_ROWS = 300

const money = (s: Statement) => {
  const f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: s.currency, maximumFractionDigits: 0 })
  return (v: number) => f.format(v)
}
const num = (v: number) => new Intl.NumberFormat(LOCALE).format(v)
const pct = (v: number | null) => (v === null ? '—' : `${v < 0 ? '−' : v > 0 ? '+' : ''}%${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(Math.abs(v) * 100)}`)
const share = (v: number) => `%${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(v * 100)}`
const date = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const generated = (iso: string) => new Date(iso).toLocaleString(LOCALE, { dateStyle: 'long', timeStyle: 'short' })

export function statementFileName(s: Statement, ext: string): string {
  const base = s.kind === 'monthly' ? `Clario-ekstre-${s.period.from.slice(0, 7)}` : s.kind === 'daily' ? `Clario-gun-sonu-${s.period.from}` : `Clario-rapor-${s.period.from}_${s.period.to}`
  return `${base}.${ext}`
}

/** Özet göstergeler: [etiket, değer, karşılaştırma] */
function kpis(s: Statement): [string, string, string][] {
  const m = money(s)
  const t = s.totals
  return [
    ['Ciro', m(t.revenue), pct(s.changes.revenue)],
    ['Sipariş', num(t.orders), pct(s.changes.orders)],
    ['Ortalama sipariş', m(t.avgOrderValue), pct(s.changes.avgOrderValue)],
    ['Müşteri', num(t.customers), pct(s.changes.customers)],
    ['Satılan adet', num(t.units), ''],
    ['Brüt kâr', t.grossProfit === null ? '—' : `${m(t.grossProfit)}${t.grossMarginPct === null ? '' : ` (marj ${share(t.grossMarginPct)})`}`, ''],
    ['Giderler', m(s.expenses), ''],
    ['Net katkı', m(s.netContribution), ''],
    ['İptal', `${num(s.cancelled.orders)} sipariş · ${m(s.cancelled.amount)}`, ''],
    ['Yeni müşteri', num(s.newCustomers), ''],
  ]
}

const comparedLabel = (s: Statement) =>
  `Karşılaştırma: ${date(s.previousPeriod.from)}${s.previousPeriod.from === s.previousPeriod.to ? '' : ` – ${date(s.previousPeriod.to)}`}`

const periodLabel = (s: Statement) => (s.period.from === s.period.to ? date(s.period.from) : `${date(s.period.from)} – ${date(s.period.to)}`)

function breakdownRows(s: Statement, rows: ReportBreakdownRow[]): string[][] {
  const m = money(s)
  return rows.map((r) => [r.name ?? 'Atanmamış', m(r.revenue), share(r.share), num(r.orders), pct(r.changePct)])
}

function orderRows(s: Statement): string[][] {
  const m = money(s)
  return s.orders
    .slice(0, MAX_ORDER_ROWS)
    .map((o) => [date(o.date), o.orderNo ?? `#${o.id}`, o.customer, num(o.items), m(o.amount), o.status === 'cancelled' ? 'İptal' : 'Teslim'])
}

/** Belgelerde sırayla yer alan tablolar */
function sections(s: Statement): { title: string; head: string[]; rows: string[][]; note?: string }[] {
  const m = money(s)
  const list: { title: string; head: string[]; rows: string[][]; note?: string }[] = []
  if (s.days.length > 1) {
    list.push({ title: 'Günlük döküm', head: ['Tarih', 'Sipariş', 'Adet', 'Ciro'], rows: s.days.filter((d) => d.orders > 0).map((d) => [date(d.date), num(d.orders), num(d.units), m(d.revenue)]) })
  }
  const head = ['Ad', 'Ciro', 'Pay', 'Sipariş', 'Değişim']
  if (s.categories.length) list.push({ title: 'Kategoriler', head, rows: breakdownRows(s, s.categories) })
  if (s.products.length) list.push({ title: 'En çok satan ürünler', head, rows: breakdownRows(s, s.products) })
  if (s.customers.length) list.push({ title: 'En büyük müşteriler', head, rows: breakdownRows(s, s.customers) })
  if (s.regions.length > 1) list.push({ title: 'Bölgeler', head, rows: breakdownRows(s, s.regions) })
  if (s.projects.length) list.push({ title: 'Projeler', head, rows: breakdownRows(s, s.projects) })
  if (s.expenseCategories.length) {
    list.push({ title: 'Giderler', head: ['Gider türü', 'Kayıt', 'Tutar'], rows: s.expenseCategories.map((e) => [e.category, num(e.count), m(e.amount)]) })
  }
  if (s.orders.length) {
    list.push({
      title: `İşlemler (${num(s.ordersTotal)})`,
      head: ['Tarih', 'No', 'Müşteri', 'Kalem', 'Tutar', 'Durum'],
      rows: orderRows(s),
      note: s.ordersTotal > MAX_ORDER_ROWS ? `İlk ${MAX_ORDER_ROWS} işlem gösterildi; tam liste Excel dosyasında.` : undefined,
    })
  }
  return list
}

// ── PDF ──

export async function downloadStatementPdf(input: Statement): Promise<void> {
  // Belge kendi kopyasından üretilir (kütüphane nesneleri değiştirebilir)
  const s = structuredClone(input)
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  ;(pdfMake as unknown as { addVirtualFileSystem(v: unknown): void }).addVirtualFileSystem(vfs)

  const accent = '#14b8a6'
  const muted = '#64748b'
  const content: unknown[] = [
    { text: 'Clario', color: accent, bold: true, fontSize: 11 },
    { text: s.title, style: 'title' },
    { text: [s.business.name, s.business.email].filter(Boolean).join(' · '), color: muted, margin: [0, 2, 0, 0] },
    { text: `Dönem: ${periodLabel(s)} · ${comparedLabel(s)} · Para birimi: ${s.currency}`, color: muted, fontSize: 9, margin: [0, 2, 0, 14] },
    {
      table: {
        widths: ['*', 'auto', 'auto'],
        body: [
          [{ text: 'Gösterge', style: 'th' }, { text: 'Değer', style: 'th', alignment: 'right' }, { text: 'Değişim', style: 'th', alignment: 'right' }],
          ...kpis(s).map(([label, value, change]) => [label, { text: value, alignment: 'right', bold: true }, { text: change, alignment: 'right', color: muted }]),
        ],
      },
      layout: 'lightHorizontalLines',
    },
    { text: 'Öne çıkanlar', style: 'h2' },
    // pdfmake verilen dizileri yerinde değiştirir: ekrandaki veriye dokunmasın diye kopya
    { ul: [...s.highlights], margin: [0, 0, 0, 4] },
  ]
  for (const section of sections(s)) {
    const numeric = (i: number) => i > 0 && section.head[i] !== 'Müşteri' && section.head[i] !== 'No' && section.head[i] !== 'Durum'
    content.push({ text: section.title, style: 'h2' })
    content.push({
      table: {
        headerRows: 1,
        widths: section.head.map((_, i) => (i === (section.head.includes('Müşteri') ? 2 : 0) ? '*' : 'auto')),
        body: [
          section.head.map((h, i) => ({ text: h, style: 'th', alignment: numeric(i) ? 'right' : 'left' })),
          ...section.rows.map((row) => row.map((cell, i) => ({ text: cell, alignment: numeric(i) ? 'right' : 'left' }))),
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    })
    if (section.note) content.push({ text: section.note, color: muted, fontSize: 8, margin: [0, 4, 0, 0] })
  }

  const doc = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#0f172a' },
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 4, 0, 0] },
      h2: { fontSize: 13, bold: true, margin: [0, 16, 0, 6] },
      th: { bold: true, color: muted, fontSize: 9 },
    },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `Clario · Oluşturulma: ${generated(s.generatedAt)}`, color: muted, fontSize: 8 },
        { text: `${page} / ${pages}`, alignment: 'right', color: muted, fontSize: 8 },
      ],
      margin: [40, 16, 40, 0],
    }),
  }
  const pdf = (pdfMake as unknown as { createPdf(d: unknown): { getBlob(): Promise<Blob> } }).createPdf(doc)
  await saveBlob(await pdf.getBlob(), statementFileName(s, 'pdf'))
}

// ── Word ──

export async function downloadStatementWord(s: Statement): Promise<void> {
  const docx = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, BorderStyle } = docx
  const muted = '64748B'
  const border = { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' }
  const borders = { top: border, bottom: border, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }

  const cell = (text: string, opts: { bold?: boolean; right?: boolean; color?: string } = {}) =>
    new TableCell({
      borders,
      children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: 18 })] })],
    })
  const table = (head: string[], rows: string[][], numeric: (i: number) => boolean) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, right: numeric(i), color: muted })) }),
        ...rows.map((row) => new TableRow({ children: row.map((c, i) => cell(c, { right: numeric(i) })) })),
      ],
    })

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ children: [new TextRun({ text: 'Clario', bold: true, color: '14B8A6' })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: s.title })] }),
    new Paragraph({ children: [new TextRun({ text: [s.business.name, s.business.email].filter(Boolean).join(' · '), color: muted })] }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: `Dönem: ${periodLabel(s)} · ${comparedLabel(s)} · Para birimi: ${s.currency}`, color: muted, size: 18 })],
    }),
    table(['Gösterge', 'Değer', 'Değişim'], kpis(s), (i) => i > 0),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280 }, children: [new TextRun('Öne çıkanlar')] }),
    ...s.highlights.map((h) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(h)] })),
  ]
  for (const section of sections(s)) {
    const numeric = (i: number) => i > 0 && !['Müşteri', 'No', 'Durum'].includes(section.head[i]!)
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun(section.title)] }))
    children.push(table(section.head, section.rows, numeric))
    if (section.note) children.push(new Paragraph({ children: [new TextRun({ text: section.note, color: muted, size: 16 })] }))
  }
  children.push(
    new Paragraph({ spacing: { before: 320 }, children: [new TextRun({ text: `Clario · Oluşturulma: ${generated(s.generatedAt)}`, color: muted, size: 16 })] }),
  )

  const document = new Document({
    creator: 'Clario',
    title: s.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{ children }],
  })
  const blob = await Packer.toBlob(document)
  await saveBlob(blob, statementFileName(s, 'docx'))
}

export type StatementFormat = 'excel' | 'pdf' | 'word'

/** Sorgudan (kind=monthly&month=… vb.) istenen biçimde indirir: asistan ve Raporlar ortak kullanır */
export async function downloadStatementAs(query: string, format: StatementFormat, statement?: Statement): Promise<void> {
  if (format === 'excel') {
    const params = new URLSearchParams(query)
    const name =
      params.get('kind') === 'monthly'
        ? `Clario-ekstre-${params.get('month')}`
        : params.get('kind') === 'daily'
          ? `Clario-gun-sonu-${params.get('date')}`
          : `Clario-rapor-${params.get('from')}_${params.get('to')}`
    return downloadApiFile(statementExcelPath(query), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }
  const data = statement ?? (await getStatement(query))
  return format === 'pdf' ? downloadStatementPdf(data) : downloadStatementWord(data)
}
