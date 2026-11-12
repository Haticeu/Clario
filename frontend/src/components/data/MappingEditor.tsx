import type { ImportAnalysis, ImportMapping, SheetKey } from '../../types'
import { missingFields } from '../../utils/importMapping'
import { Badge, Panel } from '../ui'

type SheetMapping = ImportMapping['sheets'][number]

/**
 * Kullanıcının dosyasındaki sayfaların ve sütunların Clario alanlarına nasıl eşlendiğini gösterir;
 * sayfa türü ve her sütunun karşılığı değiştirilebilir.
 */
export function MappingEditor({
  analysis,
  mapping,
  onChange,
}: {
  analysis: ImportAnalysis
  mapping: ImportMapping
  onChange: (mapping: ImportMapping) => void
}) {
  const typeOf = (key: SheetKey | null) => analysis.types.find((t) => t.key === key)

  function updateSheet(index: number, next: SheetMapping) {
    onChange({ sheets: mapping.sheets.map((s, i) => (i === index ? next : s)) })
  }

  return (
    <Panel
      title="Sütun eşleştirme"
      subtitle="Clario dosyanızdaki sayfaları ve sütunları anlamlarına göre eşleştirdi. Yanlış bir eşleştirme varsa değiştirin."
    >
      <div className="stack" style={{ gap: 16 }}>
        {analysis.sheets.map((sheet, index) => {
          const current = mapping.sheets[index]!
          const type = typeOf(current.type)
          const missing = type ? missingFields(type, current.columns) : []
          return (
            <div key={sheet.name} className="panel" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">{sheet.name}</div>
                  <div className="panel-subtitle">
                    {sheet.rowCount} veri satırı · başlıklar {sheet.headerRow}. satırda
                  </div>
                </div>
                <label className="field" style={{ minWidth: 220 }}>
                  <span>Bu sayfadaki veri</span>
                  <select
                    className="input"
                    value={current.type ?? ''}
                    onChange={(e) => {
                      const key = (e.target.value || null) as SheetKey | null
                      updateSheet(index, { ...current, type: key, columns: key ? { ...sheet.suggestions[key] } : {} })
                    }}
                  >
                    <option value="">İçe aktarma (yok say)</option>
                    {analysis.types.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="panel-body">
                {!type ? (
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    Bu sayfa içe aktarılmayacak. İçindeki veriyi yüklemek için yukarıdan türünü seçin.
                  </div>
                ) : (
                  <>
                    {missing.length > 0 ? (
                      <div className="alert tone-risk" style={{ marginTop: 0, marginBottom: 12 }}>
                        Eksik bilgi: <b>{missing.join(', ')}</b>. Aşağıdan bu bilgiyi içeren sütunu seçin.
                      </div>
                    ) : (
                      <div className="alert tone-opportunity" style={{ marginTop: 0, marginBottom: 12 }}>
                        Gerekli tüm bilgiler eşleşti.
                      </div>
                    )}
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Dosyadaki sütun</th>
                            <th>Örnek değerler</th>
                            <th>Clario'daki karşılığı</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.columns.map((column) => {
                            const value = current.columns[String(column.index)] ?? ''
                            return (
                              <tr key={column.index}>
                                <td>
                                  <b>{column.header}</b>
                                </td>
                                <td className="muted" style={{ fontSize: 12.5 }}>
                                  {column.samples.join(' · ') || '—'}
                                </td>
                                <td style={{ minWidth: 220 }}>
                                  <select
                                    className="input"
                                    value={value}
                                    aria-label={`${column.header} sütununun karşılığı`}
                                    onChange={(e) => {
                                      const columns = { ...current.columns }
                                      // Aynı alan başka bir sütuna atanmışsa oradan kaldır
                                      for (const [k, v] of Object.entries(columns)) if (v === e.target.value) delete columns[k]
                                      if (e.target.value) columns[String(column.index)] = e.target.value
                                      else delete columns[String(column.index)]
                                      updateSheet(index, { ...current, columns })
                                    }}
                                  >
                                    <option value="">— Kullanma —</option>
                                    {type.fields.map((f) => (
                                      <option key={f.key} value={f.key}>
                                        {f.label}
                                        {f.required ? ' *' : ''}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}
        {analysis.sheets.length === 0 && <Badge tone="risk">Dosyada okunabilir bir tablo bulunamadı.</Badge>}
      </div>
    </Panel>
  )
}
