import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { analyzeImport, toApiError, uploadImport } from '../../api'
import { downloadApiFile } from '../../utils/download'
import type { ImportAnalysis, ImportIssue, ImportMapping, ImportMode, ImportReport } from '../../types'
import { notifyDataChanged } from '../../utils/dataEvents'
import { formatNumber } from '../../utils/format'
import { Panel } from '../ui'
import { initialMapping, missingFields } from '../../utils/importMapping'
import { MappingEditor } from './MappingEditor'

const MAX_BYTES = 25 * 1024 * 1024

/**
 * Excel/CSV ile toplu veri yükleme: dosya seç → Clario sütunları eşleştirir (düzeltilebilir)
 * → kontrol et → içe aktar. Clario şablonu da kullanıcının kendi tablosu da kabul edilir.
 */
export function ImportPanel({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<'analyze' | 'check' | 'import' | 'skip' | null>(null)
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function choose(next: File | null) {
    setReport(null)
    setError(null)
    setAnalysis(null)
    setMapping(null)
    if (next && /\.xls$/i.test(next.name)) {
      setError('Eski Excel biçimi (.xls) desteklenmiyor. Dosyayı Excel\'de açıp "Farklı Kaydet → Excel Çalışma Kitabı (.xlsx)" ile kaydedin.')
      return setFile(null)
    }
    if (next && next.size > MAX_BYTES) {
      setError('Dosya 25 MB\'tan büyük olamaz.')
      return setFile(null)
    }
    setFile(next)
    if (!next) return
    setBusy('analyze')
    try {
      const result = await analyzeImport(next)
      setAnalysis(result)
      setMapping(initialMapping(result))
      if (result.sheets.length === 0) setError('Dosyada okunabilir bir tablo bulunamadı.')
    } catch (err) {
      setError(toApiError(err).message)
      setFile(null)
    } finally {
      setBusy(null)
    }
  }

  async function download(path: string, filename: string) {
    try {
      await downloadApiFile(path, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  const incomplete =
    !mapping ||
    !analysis ||
    !mapping.sheets.some((s) => s.type) ||
    mapping.sheets.some((s) => {
      const type = analysis.types.find((t) => t.key === s.type)
      return type ? missingFields(type, s.columns).length > 0 : false
    })

  // Yalnızca satır hataları varsa (eksik sütun gibi yapısal hata yoksa) hatalı satırlar atlanarak içe aktarılabilir
  const canSkip = !!report && !report.ok && !report.committed && report.rowErrors > 0 && report.errors.every((e) => e.row !== null)
  const importHint = !file
    ? null
    : !report
      ? 'Önce "Kontrol et" ile dosyayı doğrulayın.'
      : report.committed
        ? null
        : !report.ok
          ? canSkip
            ? `${formatNumber(report.rowErrors)} satırda hata var. Excel'de düzeltip tekrar kontrol edin ya da bu satırları atlayarak içe aktarın.`
            : 'Önce aşağıdaki hataları giderin (eksik sütun eşleştirmesi vb.), sonra tekrar kontrol edin.'
          : null

  async function run(dryRun: boolean, skipInvalid = false) {
    if (!file) return
    if (!dryRun && mode === 'replace' && !window.confirm('"Tümünü değiştir" seçili: mevcut TÜM verileriniz silinip bu dosyadakilerle değiştirilecek. Devam edilsin mi?')) {
      return
    }
    setBusy(dryRun ? 'check' : skipInvalid ? 'skip' : 'import')
    setError(null)
    try {
      const result = await uploadImport(file, mode, dryRun, mapping ?? undefined, skipInvalid)
      setReport(result)
      if (result.committed) {
        notifyDataChanged()
        onImported()
      }
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(null)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void choose(event.dataTransfer.files[0] ?? null)
  }

  return (
    <div className="stack">
      <div className="steps">
        <Panel title={<><span className="step-number">1</span>Şablonu indirin</>}>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Kendi Excel tablonuz, Logo / Mikro gibi ERP'lerin Excel dökümü veya e-Fatura arşiviniz (.xml / .zip) varsa doğrudan 2. adıma
            geçin: Clario "Miktar", "Tutar", "Cari Adı", "Fiş No", "Malzeme Kodu" gibi başlıkları ve GİB e-Fatura (UBL-TR) dosyalarını tanır.
            Sıfırdan başlıyorsanız şablonu kullanın: Ürünler, Müşteriler, Satışlar, Stok, Giderler, Tahsilatlar, Bölgeler ve Çalışanlar sayfaları var.
          </p>
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="button button-primary" onClick={() => void download('/import/template', 'clario-veri-sablonu.xlsx')}>
              Boş şablonu indir (.xlsx)
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void download('/import/export', `clario-veriler-${new Date().toISOString().slice(0, 10)}.xlsx`)}
            >
              Mevcut verilerimi indir
            </button>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
            "Mevcut verilerimi indir" ile verilerinizi aynı biçimde alıp Excel'de düzenleyebilir, sonra geri yükleyebilirsiniz.
          </p>
        </Panel>

        <Panel title={<><span className="step-number">2</span>Doldurduğunuz dosyayı seçin</>}>
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{busy === 'analyze' ? 'Sütunlar tanınıyor…' : `${formatNumber(file.size / 1024, 0)} KB · değiştirmek için tıklayın`}</span>
              </>
            ) : (
              <>
                <strong>Excel, CSV veya e-Fatura dosyanızı buraya sürükleyin</strong>
                <span>veya seçmek için tıklayın (.xlsx, .csv, .xml, .zip) — Clario şablonu, kendi tablonuz, ERP dökümü veya e-Fatura arşivi</span>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,.xml,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/xml,application/xml,application/zip"
            hidden
            onChange={(e) => {
              void choose(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />

          <div className="radio-group" style={{ marginTop: 14 }}>
            <label className="radio">
              <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => { setMode('merge'); setReport(null) }} />
              <span>
                <b>Ekle / güncelle</b>
                <div className="muted">Yeni kayıtlar eklenir; aynı ürün kodu, müşteri adı ve sipariş numarası güncellenir. Aynı dosyayı tekrar yüklemek kayıtları çoğaltmaz.</div>
              </span>
            </label>
            <label className="radio">
              <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => { setMode('replace'); setReport(null) }} />
              <span>
                <b>Tümünü değiştir</b>
                <div className="muted">Mevcut tüm veriler silinir, yerine bu dosyadakiler yazılır.</div>
              </span>
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="button" onClick={() => void run(true)} disabled={!file || busy !== null || incomplete}>
              {busy === 'check' ? 'Kontrol ediliyor…' : 'Kontrol et'}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void run(false)}
              disabled={!file || busy !== null || !report || !report.ok || report.committed}
              title={importHint ?? undefined}
            >
              {busy === 'import' ? 'İçe aktarılıyor…' : 'İçe aktar'}
            </button>
            {canSkip && (
              <button type="button" className="button" onClick={() => void run(false, true)} disabled={busy !== null}>
                {busy === 'skip' ? 'İçe aktarılıyor…' : `Hatalı ${formatNumber(report.rowErrors)} satırı atlayarak içe aktar`}
              </button>
            )}
          </div>
          {importHint && busy === null && <p className="faint" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'right' }}>{importHint}</p>}
          {error && (
            <div className="alert tone-risk" role="alert">
              {error}
            </div>
          )}
        </Panel>
      </div>

      {analysis && mapping && analysis.sheets.length > 0 && (
        <MappingEditor
          analysis={analysis}
          mapping={mapping}
          onChange={(next) => {
            setMapping(next)
            setReport(null)
          }}
        />
      )}

      {report && <ImportReportView report={report} />}
    </div>
  )
}

const LABELS: [keyof ImportReport['counts'], string][] = [
  ['products', 'Ürün'],
  ['customers', 'Müşteri'],
  ['orders', 'Sipariş'],
  ['regions', 'Bölge'],
  ['employees', 'Çalışan'],
]

function ImportReportView({ report }: { report: ImportReport }) {
  const { counts } = report
  const tone = report.committed ? 'opportunity' : report.ok ? 'accent' : 'risk'
  const title = report.committed
    ? 'İçe aktarma tamamlandı'
    : report.ok
      ? 'Dosya hazır — içe aktarabilirsiniz'
      : report.rowErrors > 0
        ? `${formatNumber(report.rowErrors)} satırda hata var`
        : 'Dosyada eksik bilgi var — düzeltip tekrar kontrol edin'

  return (
    <Panel title={<><span className="step-number">3</span>Sonuç</>}>
      <div className={`callout tone-${tone}`}>
        <div>
          <div className="callout-title">{title}</div>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {report.committed ? (
              <>
                Verileriniz kaydedildi. Analizler güncellendi: <Link to="/">Genel Bakış'a git →</Link>
              </>
            ) : report.ok ? (
              'Aşağıdaki özet kontrol edildi, henüz hiçbir şey kaydedilmedi. "İçe aktar" ile kaydedin.'
            ) : (
              'Hiçbir şey kaydedilmedi. Hatalar türüne göre gruplandı; satır numaraları Excel’deki satırlardır. Düzeltip tekrar kontrol edebilir ya da hatalı satırları atlayarak içe aktarabilirsiniz.'
            )}
          </div>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Kayıt türü</th>
              <th className="num">{report.committed ? 'Eklendi' : 'Eklenecek'}</th>
              <th className="num">{report.committed ? 'Güncellendi' : 'Güncellenecek'}</th>
            </tr>
          </thead>
          <tbody>
            {LABELS.map(([key, label]) => {
              const tally = counts[key] as { created: number; updated: number }
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className="num">{formatNumber(tally.created)}</td>
                  <td className="num">{formatNumber(tally.updated)}</td>
                </tr>
              )
            })}
            <tr>
              <td>Satış kalemi</td>
              <td className="num">{formatNumber(counts.orderItems)}</td>
              <td className="num">—</td>
            </tr>
            <tr>
              <td>Stok kaydı (ürün × bölge)</td>
              <td className="num">{formatNumber(counts.inventory)}</td>
              <td className="num">—</td>
            </tr>
            <tr>
              <td>Gider</td>
              <td className="num">{formatNumber(counts.expenses.created)}</td>
              <td className="num">{counts.expenses.skipped > 0 ? `${formatNumber(counts.expenses.skipped)} tekrar atlandı` : '—'}</td>
            </tr>
            {counts.payments && (counts.payments.created > 0 || counts.payments.skipped > 0) && (
              <tr>
                <td>Tahsilat</td>
                <td className="num">{formatNumber(counts.payments.created)}</td>
                <td className="num">{counts.payments.skipped > 0 ? `${formatNumber(counts.payments.skipped)} tekrar atlandı` : '—'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <IssueList title="Hatalar" tone="risk" issues={report.errors} truncated={report.truncated} />
      <IssueList title="Uyarılar" tone="warning" issues={report.warnings} />
    </Panel>
  )
}

interface IssueGroup {
  sheet: string
  message: string
  rows: number[]
  count: number
}

/** Aynı sayfa + alan + mesaj kalıbındaki sorunları tek satırda toplar ("…" içindeki değerler kalıba dahil edilmez). */
function groupIssues(issues: ImportIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const issue of issues) {
    const key = `${issue.sheet}|${issue.field ?? ''}|${issue.message.replace(/"[^"]*"/g, '"…"')}`
    const group = groups.get(key)
    if (group) {
      group.count++
      if (issue.row !== null) group.rows.push(issue.row)
    } else {
      groups.set(key, { sheet: issue.sheet, message: issue.message, rows: issue.row === null ? [] : [issue.row], count: 1 })
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

const ROW_PREVIEW = 8

function IssueList({ title, tone, issues, truncated = false }: { title: string; tone: 'risk' | 'warning'; issues: ImportIssue[]; truncated?: boolean }) {
  if (issues.length === 0) return null
  const groups = groupIssues(issues)
  return (
    <div style={{ marginTop: 16 }}>
      <div className="panel-title" style={{ color: `var(--${tone})` }}>
        {title} ({issues.length}
        {truncated ? '+' : ''})
      </div>
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Sayfa</th>
              <th>Satırlar</th>
              <th>Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, i) => (
              <tr key={i}>
                <td className="nowrap">{group.sheet}</td>
                <td className="nowrap">
                  {group.rows.length === 0
                    ? '—'
                    : group.rows.slice(0, ROW_PREVIEW).join(', ') + (group.rows.length > ROW_PREVIEW ? ` … (+${group.rows.length - ROW_PREVIEW})` : '')}
                </td>
                <td>
                  {group.message}
                  {group.count > 1 && <div className="cell-sub">{formatNumber(group.count)} satırda aynı sorun (örnek gösterildi)</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
