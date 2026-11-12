import { useState, type FormEvent } from 'react'
import { createOrder, deleteOrder, getOrderItems, listOrders, toApiError, updateOrder } from '../../api'
import { currencySymbol, useCurrency } from '../../currency'
import { useApi } from '../../hooks/useApi'
import type { CustomerRecord, OrderItemRecord, OrderRecord, ProductRecord } from '../../types'
import { notifyDataChanged } from '../../utils/dataEvents'
import { formatCurrency, formatDate, formatNumber } from '../../utils/format'
import { AsyncContent, EmptyState } from '../states'
import { Badge, Panel } from '../ui'

const PAGE_SIZE = 50

interface Line {
  productId: string
  quantity: string
  unitPrice: string
}

const emptyLine = (): Line => ({ productId: '', quantity: '1', unitPrice: '' })
const today = () => new Date().toISOString().slice(0, 10)

/** Girilmiş departman/proje adları: formlarda öneri olarak sunulur (aynı adın farklı yazılmasını önler) */
interface Suggestions {
  departments: string[]
  projects: string[]
}

const distinct = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'tr-TR'))

/** Satırlar veri girişi ekranında olduğu için ana para biriminde biçimlenir. */
function useMoney() {
  const { base, currencies } = useCurrency()
  return { money: (value: number) => formatCurrency(value, base), symbol: currencySymbol(currencies, base) }
}

function SuggestionLists({ suggestions }: { suggestions: Suggestions }) {
  return (
    <>
      <datalist id="order-departments">
        {suggestions.departments.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="order-projects">
        {suggestions.projects.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  )
}

export function OrdersManager({ customers, products }: { customers: CustomerRecord[]; products: ProductRecord[] }) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const orders = useApi((signal) => listOrders(limit, 0, signal))
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<{ id: number; items: OrderItemRecord[] } | null>(null)

  const missing = customers.length === 0 ? 'müşteri' : products.length === 0 ? 'ürün' : null
  const suggestions: Suggestions = {
    departments: distinct((orders.data?.items ?? []).map((o) => o.department)),
    projects: distinct((orders.data?.items ?? []).map((o) => o.project)),
  }

  function changed() {
    orders.reload()
    notifyDataChanged()
  }

  async function toggleItems(order: OrderRecord) {
    if (expanded?.id === order.id) return setExpanded(null)
    try {
      setExpanded({ id: order.id, items: await getOrderItems(order.id) })
    } catch (err) {
      window.alert(toApiError(err).message)
    }
  }

  async function toggleStatus(order: OrderRecord) {
    try {
      await updateOrder(order.id, { status: order.status === 'delivered' ? 'cancelled' : 'delivered' })
      changed()
    } catch (err) {
      window.alert(toApiError(err).message)
    }
  }

  async function remove(order: OrderRecord) {
    if (!window.confirm(`${order.orderNo ?? `#${order.id}`} numaralı sipariş silinsin mi? Bu işlem geri alınamaz.`)) return
    try {
      await deleteOrder(order.id)
      changed()
    } catch (err) {
      window.alert(toApiError(err).message)
    }
  }

  async function assign(order: OrderRecord, department: string, project: string) {
    try {
      await updateOrder(order.id, { department: department.trim() || null, project: project.trim() || null })
      changed()
    } catch (err) {
      window.alert(toApiError(err).message)
    }
  }

  return (
    <div className="stack">
      <SuggestionLists suggestions={suggestions} />
      {open && (
        <OrderForm
          customers={customers}
          products={products}
          onCancel={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            changed()
          }}
        />
      )}

      <Panel
        title="Satışlar"
        subtitle="Her sipariş bir müşteriye, bir tarihe ve bir ya da daha fazla ürün satırına sahiptir. Departman ve proje atamak için sipariş numarasına tıklayın."
      >
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 13 }}>
            {orders.data ? `${formatNumber(orders.data.total)} sipariş` : ''}
          </span>
          <button type="button" className="button button-primary" onClick={() => setOpen(true)} disabled={Boolean(missing)}>
            + Yeni satış
          </button>
        </div>
        {missing && (
          <div className="alert tone-warning">Satış girebilmek için önce en az bir {missing} ekleyin.</div>
        )}

        <AsyncContent state={orders}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="Henüz satış yok" description='"+ Yeni satış" ile ekleyin ya da geçmiş satışlarınızı Excel ile toplu yükleyin.' />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Sipariş</th>
                        <th>Tarih</th>
                        <th>Müşteri</th>
                        <th>Departman / Proje</th>
                        <th className="num">Kalem</th>
                        <th className="num">Tutar</th>
                        <th>Durum</th>
                        <th className="num">İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((order) => (
                        <OrderRow
                          key={order.id}
                          order={order}
                          items={expanded?.id === order.id ? expanded.items : null}
                          onToggleItems={() => void toggleItems(order)}
                          onToggleStatus={() => void toggleStatus(order)}
                          onAssign={(department, project) => void assign(order, department, project)}
                          onDelete={() => void remove(order)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.total > data.items.length && (
                  <div className="form-actions" style={{ justifyContent: 'center' }}>
                    <button type="button" className="button" onClick={() => { setLimit(limit + PAGE_SIZE); orders.reload() }}>
                      Daha fazla göster ({formatNumber(data.total - data.items.length)} sipariş daha)
                    </button>
                  </div>
                )}
              </>
            )
          }
        </AsyncContent>
      </Panel>
    </div>
  )
}

function OrderRow({
  order,
  items,
  onToggleItems,
  onToggleStatus,
  onAssign,
  onDelete,
}: {
  order: OrderRecord
  items: OrderItemRecord[] | null
  onToggleItems: () => void
  onToggleStatus: () => void
  onAssign: (department: string, project: string) => void
  onDelete: () => void
}) {
  const cancelled = order.status === 'cancelled'
  const { money } = useMoney()
  return (
    <>
      <tr>
        <td>
          <button type="button" className="button button-small" onClick={onToggleItems} aria-expanded={items !== null}>
            {items ? '▾' : '▸'} {order.orderNo ?? `#${order.id}`}
          </button>
        </td>
        <td>{formatDate(order.orderDate)}</td>
        <td>
          {order.customerName}
          <div className="cell-sub">{order.regionName}</div>
        </td>
        <td>
          {order.department ?? <span className="faint">—</span>}
          {order.project && <div className="cell-sub">{order.project}</div>}
        </td>
        <td className="num">{order.itemCount}</td>
        <td className="num">{money(order.totalAmount)}</td>
        <td>
          <Badge tone={cancelled ? 'muted' : 'opportunity'} dot>
            {cancelled ? 'İptal' : 'Teslim edildi'}
          </Badge>
        </td>
        <td>
          <div className="row-actions">
            <button type="button" className="button button-small" onClick={onToggleStatus}>
              {cancelled ? 'Geri al' : 'İptal et'}
            </button>
            <button type="button" className="button button-small button-danger" onClick={onDelete}>
              Sil
            </button>
          </div>
        </td>
      </tr>
      {items && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
            {items.map((item) => (
              <div key={item.productId} className="cell-sub" style={{ padding: '2px 0' }}>
                {item.sku} · {item.productName} — {formatNumber(item.quantity)} adet × {money(item.unitPrice)}
              </div>
            ))}
            <AssignForm order={order} onSave={onAssign} />
          </td>
        </tr>
      )}
    </>
  )
}

/** Siparişin departman ve projesini sonradan atama/değiştirme */
function AssignForm({ order, onSave }: { order: OrderRecord; onSave: (department: string, project: string) => void }) {
  const [department, setDepartment] = useState(order.department ?? '')
  const [project, setProject] = useState(order.project ?? '')
  const dirty = department !== (order.department ?? '') || project !== (order.project ?? '')
  return (
    <form
      className="assign-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(department, project)
      }}
    >
      <label className="field">
        <span>Departman</span>
        <input className="input" list="order-departments" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="—" />
      </label>
      <label className="field">
        <span>Proje / iş</span>
        <input className="input" list="order-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="—" />
      </label>
      <button type="submit" className="button button-small button-primary" disabled={!dirty}>
        Kaydet
      </button>
    </form>
  )
}

function OrderForm({
  customers,
  products,
  onCancel,
  onSaved,
}: {
  customers: CustomerRecord[]
  products: ProductRecord[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [orderDate, setOrderDate] = useState(today())
  const [customerId, setCustomerId] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [department, setDepartment] = useState('')
  const [project, setProject] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const { money, symbol } = useMoney()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const productById = new Map(products.map((p) => [String(p.id), p]))
  const updateLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  const total = lines.reduce((sum, line) => {
    const price = line.unitPrice.trim() ? Number(line.unitPrice.replace(/\./g, '').replace(',', '.')) : productById.get(line.productId)?.listPrice
    return sum + (Number(line.quantity) || 0) * (price || 0)
  }, 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createOrder({
        orderDate,
        customerId,
        orderNo: orderNo.trim() || null,
        department: department.trim() || null,
        project: project.trim() || null,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice.trim() || null })),
      })
      onSaved()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title="Yeni satış">
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Tarih *</span>
            <input className="input" type="date" required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Müşteri *</span>
            <select className="input" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Seçin…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.regionName})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sipariş no</span>
            <input className="input" placeholder="Boşsa otomatik verilir" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          </label>
          <label className="field">
            <span>Departman</span>
            <input className="input" list="order-departments" placeholder="Opsiyonel, ör. Kurumsal Satış" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="field">
            <span>Proje / iş</span>
            <input className="input" list="order-projects" placeholder="Opsiyonel" value={project} onChange={(e) => setProject(e.target.value)} />
          </label>
        </div>

        <div className="line-items" style={{ marginTop: 18 }}>
          {lines.map((line, index) => {
            const product = productById.get(line.productId)
            return (
              <div className="line-item" key={index}>
                <label className="field">
                  <span>Ürün *</span>
                  <select className="input" required value={line.productId} onChange={(e) => updateLine(index, { productId: e.target.value })}>
                    <option value="">Seçin…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Adet *</span>
                  <input className="input" inputMode="numeric" required value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                </label>
                <label className="field">
                  <span>Birim fiyat ({symbol})</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={product ? `Liste: ${formatNumber(product.listPrice, 2)}` : 'Liste fiyatı'}
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  disabled={lines.length === 1}
                  aria-label={`${index + 1}. satırı kaldır`}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <div>
            <button type="button" className="button button-small" onClick={() => setLines([...lines, emptyLine()])}>
              + Ürün satırı ekle
            </button>
          </div>
        </div>

        {error && (
          <div className="alert tone-risk" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions" style={{ alignItems: 'center' }}>
          <span className="muted" style={{ marginRight: 'auto' }}>
            Toplam: <b>{money(total)}</b>
          </span>
          <button type="button" className="button" onClick={onCancel} disabled={saving}>
            Vazgeç
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Satışı kaydet'}
          </button>
        </div>
      </form>
    </Panel>
  )
}
