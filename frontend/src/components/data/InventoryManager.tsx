import { useState } from 'react'
import { listInventory, saveInventory, toApiError } from '../../api'
import { useApi } from '../../hooks/useApi'
import type { ProductRecord, RegionRecord } from '../../types'
import { notifyDataChanged } from '../../utils/dataEvents'
import { formatNumber } from '../../utils/format'
import { AsyncContent, EmptyState } from '../states'
import { Panel } from '../ui'

const key = (productId: number, regionId: number) => `${productId}:${regionId}`

/** Ürün × bölge stok tablosu; hücreler doğrudan düzenlenir, değişenler tek seferde kaydedilir. */
export function InventoryManager({ products, regions }: { products: ProductRecord[]; regions: RegionRecord[] }) {
  const inventory = useApi(listInventory)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ tone: 'opportunity' | 'risk'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  if (products.length === 0 || regions.length === 0) {
    return (
      <Panel title="Stok">
        <EmptyState title="Önce ürün ve bölge ekleyin" description="Stok, her ürünün her bölgedeki mevcut adedidir." />
      </Panel>
    )
  }

  const changedCount = Object.keys(edits).length

  async function save() {
    const items = Object.entries(edits).map(([k, value]) => {
      const [productId, regionId] = k.split(':').map(Number)
      return { productId: productId!, regionId: regionId!, quantity: Number(value.replace(/\./g, '')) }
    })
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 0)) {
      setMessage({ tone: 'risk', text: 'Stok adetleri 0 veya daha büyük tam sayı olmalıdır.' })
      return
    }
    setSaving(true)
    try {
      await saveInventory(items)
      setEdits({})
      setMessage({ tone: 'opportunity', text: `${items.length} stok değeri kaydedildi.` })
      inventory.reload()
      notifyDataChanged()
    } catch (err) {
      setMessage({ tone: 'risk', text: toApiError(err).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title="Stok" subtitle="Her ürünün her bölgedeki bugünkü stok adedi. Hücreye tıklayıp değiştirin, ardından kaydedin.">
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 13 }}>
          {changedCount > 0 ? `${changedCount} değişiklik kaydedilmedi` : 'Değişiklik yok'}
        </span>
        <div className="row-actions">
          <button type="button" className="button" onClick={() => setEdits({})} disabled={changedCount === 0 || saving}>
            Değişiklikleri geri al
          </button>
          <button type="button" className="button button-primary" onClick={() => void save()} disabled={changedCount === 0 || saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
      {message && <div className={`alert tone-${message.tone}`}>{message.text}</div>}

      <AsyncContent state={inventory}>
        {(rows) => {
          const stock = new Map(rows.map((r) => [key(r.productId, r.regionId), r.quantity]))
          return (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ürün</th>
                    {regions.map((r) => (
                      <th key={r.id} className="num">
                        {r.name}
                      </th>
                    ))}
                    <th className="num">Toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    let total = 0
                    return (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          <div className="cell-sub">{p.sku}</div>
                        </td>
                        {regions.map((r) => {
                          const k = key(p.id, r.id)
                          const saved = stock.get(k) ?? 0
                          const value = edits[k] ?? String(saved)
                          total += Number(value) || 0
                          return (
                            <td key={r.id} className="num">
                              <input
                                className={`input input-cell${k in edits ? ' changed' : ''}`}
                                inputMode="numeric"
                                value={value}
                                aria-label={`${p.name} · ${r.name} stok`}
                                onChange={(e) => {
                                  const next = { ...edits }
                                  if (e.target.value === String(saved)) delete next[k]
                                  else next[k] = e.target.value
                                  setEdits(next)
                                }}
                              />
                            </td>
                          )
                        })}
                        <td className="num">
                          <b>{formatNumber(total)}</b>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }}
      </AsyncContent>
    </Panel>
  )
}
