import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { listResource, toApiError } from '../api'
import { ImportPanel } from '../components/data/ImportPanel'
import { InventoryManager } from '../components/data/InventoryManager'
import { OrdersManager } from '../components/data/OrdersManager'
import { ResourceManager } from '../components/data/ResourceManager'
import { PageHeader } from '../components/ui'
import { currencySymbol, useCurrency } from '../currency'
import { useApi } from '../hooks/useApi'
import { formatCurrency, formatDate, formatNumber } from '../utils/format'

const TABS = [
  { id: 'import', label: 'Excel ile yükle' },
  { id: 'sales', label: 'Satışlar' },
  { id: 'products', label: 'Ürünler' },
  { id: 'customers', label: 'Müşteriler' },
  { id: 'inventory', label: 'Stok' },
  { id: 'expenses', label: 'Giderler' },
  { id: 'payments', label: 'Tahsilatlar' },
  { id: 'regions', label: 'Bölgeler' },
  { id: 'employees', label: 'Çalışanlar' },
] as const

type TabId = (typeof TABS)[number]['id']

const num = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))
const blocker = (text: string) => <div className="alert tone-warning">{text}</div>

export default function DataPage() {
  const [params, setParams] = useSearchParams()
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'import'

  // Formlardaki açılır listeler için yardımcı listeler
  const regions = useApi((signal) => listResource('regions', signal))
  const employees = useApi((signal) => listResource('employees', signal))
  const customers = useApi((signal) => listResource('customers', signal))
  const products = useApi((signal) => listResource('products', signal))
  const reloadLookups = () => {
    regions.reload()
    employees.reload()
    customers.reload()
    products.reload()
  }

  // Veri girişi ekranları her zaman verilerin girildiği (ana) para biriminde çalışır
  const { base, currencies } = useCurrency()
  const symbol = currencySymbol(currencies, base)
  const money = (value: number) => formatCurrency(value, base)

  const regionOptions = (regions.data ?? []).map((r) => ({ value: r.id, label: r.name }))
  const employeeOptions = (employees.data ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.role})` }))
  const noRegion = regionOptions.length === 0 ? blocker('Önce "Bölgeler" sekmesinden en az bir bölge ekleyin.') : undefined

  return (
    <>
      <PageHeader
        title="Veri Yönetimi"
        description="İşletme verilerinizi Excel ile toplu olarak yükleyin veya kayıtları tek tek ekleyip düzenleyin. Tüm analizler bu verilerden hesaplanır."
        actions={<BaseCurrencySetting />}
      />

      <div className="tabs" role="tablist" aria-label="Veri türleri">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'import' && <ImportPanel onImported={reloadLookups} />}

      {tab === 'sales' && <OrdersManager customers={customers.data ?? []} products={products.data ?? []} />}

      {tab === 'inventory' && <InventoryManager products={products.data ?? []} regions={regions.data ?? []} />}

      {tab === 'products' && (
        <ResourceManager
          resource="products"
          title="Ürünler"
          description="Ürün kodu (SKU) her ürün için benzersiz olmalıdır. Satışlarda ve stokta bu kod kullanılır."
          noun="ürün"
          label={(p) => `${p.sku} ${p.name}`}
          onChanged={reloadLookups}
          columns={[
            { label: 'Kod', render: (p) => p.sku },
            { label: 'Ürün', render: (p) => <>{p.name}<div className="cell-sub">{p.category}</div></> },
            { label: 'Maliyet', render: (p) => money(p.unitCost), align: 'right' },
            { label: 'Liste fiyatı', render: (p) => money(p.listPrice), align: 'right' },
            { label: 'Toplam stok', render: (p) => formatNumber(p.totalStock), align: 'right' },
          ]}
          fields={[
            { key: 'sku', label: 'Ürün kodu (SKU)', type: 'text', required: true, placeholder: 'URN-001' },
            { key: 'name', label: 'Ürün / hizmet adı', type: 'text', required: true },
            { key: 'category', label: 'Kategori', type: 'text', required: true, placeholder: 'Hizmet, Yazılım, Malzeme…', suggest: true },
            { key: 'unitCost', label: `Birim maliyet (${symbol})`, type: 'number', required: true },
            { key: 'listPrice', label: `Liste fiyatı (${symbol})`, type: 'number', required: true },
          ]}
          toForm={(p) => ({ sku: p.sku, name: p.name, category: p.category, unitCost: num(p.unitCost), listPrice: num(p.listPrice) })}
        />
      )}

      {tab === 'customers' && (
        <ResourceManager
          resource="customers"
          title="Müşteriler"
          description="Size satış yaptığınız bayiler ve mağazalar. Kayıp riski analizi her müşterinin kendi sipariş ritmine bakar."
          noun="müşteri"
          label={(c) => c.name}
          onChanged={reloadLookups}
          blocker={noRegion}
          columns={[
            { label: 'Müşteri', render: (c) => <>{c.name}<div className="cell-sub">{c.customerType}</div></> },
            { label: 'Bölge', render: (c) => c.regionName },
            { label: 'Temsilci', render: (c) => <>{c.salesRepName ?? '—'}{c.taxId && <div className="cell-sub">VKN/TCKN {c.taxId}</div>}</> },
            { label: 'Sipariş', render: (c) => formatNumber(c.orderCount), align: 'right' },
            { label: 'Son sipariş', render: (c) => (c.lastOrderDate ? formatDate(c.lastOrderDate) : '—'), align: 'right' },
          ]}
          fields={[
            { key: 'name', label: 'Müşteri adı', type: 'text', required: true },
            { key: 'customerType', label: 'Tip', type: 'select', required: true, options: [{ value: 'Bayi', label: 'Bayi' }, { value: 'Mağaza', label: 'Mağaza' }] },
            { key: 'regionId', label: 'Bölge', type: 'select', required: true, options: regionOptions },
            { key: 'salesRepId', label: 'Satış temsilcisi', type: 'select', options: employeeOptions },
            { key: 'taxId', label: 'Vergi / TC no', type: 'text', placeholder: 'VKN (10) veya TCKN (11 hane)' },
            { key: 'paymentTermDays', label: 'Vade (gün)', type: 'number', placeholder: 'Boşsa genel vade' },
            { key: 'creditLimit', label: `Kredi limiti (${symbol})`, type: 'number', placeholder: 'Opsiyonel' },
          ]}
          toForm={(c) => ({
            name: c.name,
            customerType: c.customerType,
            regionId: String(c.regionId),
            salesRepId: num(c.salesRepId),
            taxId: c.taxId ?? '',
            paymentTermDays: num(c.paymentTermDays),
            creditLimit: num(c.creditLimit),
          })}
        />
      )}

      {tab === 'expenses' && (
        <ResourceManager
          resource="expenses"
          title="Giderler"
          description="Departman veya proje girdiğiniz giderler, Departman & Proje sayfasında hangi birimin ve işin ne kadar harcadığını ve kârlılığını gösterir. Genel Bakış'taki tahmini net kâr da giderlerden hesaplanır."
          noun="gider"
          label={(x) => `${x.category} ${x.department ?? ''} ${x.project ?? ''} ${x.description ?? ''} ${formatDate(x.expenseDate)}`}
          columns={[
            { label: 'Tarih', render: (x) => formatDate(x.expenseDate) },
            { label: 'Departman / Proje', render: (x) => <>{x.department ?? '—'}{x.project && <div className="cell-sub">{x.project}</div>}</> },
            { label: 'Gider türü', render: (x) => <>{x.category}{(x.supplier || x.description) && <div className="cell-sub">{[x.supplier, x.description].filter(Boolean).join(' · ')}</div>}</> },
            { label: 'Bölge', render: (x) => x.regionName ?? '—' },
            { label: 'Tutar', render: (x) => <>{money(x.amount)}{x.supplier && <div className="cell-sub">{x.paidDate ? `ödendi ${formatDate(x.paidDate)}` : x.dueDate ? `vade ${formatDate(x.dueDate)}` : 'ödenmedi'}</div>}</>, align: 'right' },
          ]}
          fields={[
            { key: 'expenseDate', label: 'Tarih', type: 'date', required: true },
            { key: 'amount', label: `Tutar (${symbol})`, type: 'number', required: true },
            { key: 'department', label: 'Departman', type: 'text', placeholder: 'Üretim, Satış, Yönetim…', suggest: true },
            { key: 'project', label: 'Proje / iş', type: 'text', placeholder: 'Opsiyonel', suggest: true },
            { key: 'category', label: 'Gider türü', type: 'text', placeholder: 'Personel, Malzeme, Lojistik… (boşsa Genel)', suggest: true },
            { key: 'regionId', label: 'Bölge', type: 'select', options: regionOptions },
            { key: 'description', label: 'Açıklama', type: 'text', wide: true },
            { key: 'supplier', label: 'Tedarikçi (borç takibi)', type: 'text', placeholder: 'Opsiyonel', suggest: true },
            { key: 'invoiceNo', label: 'Fatura no', type: 'text', placeholder: 'Opsiyonel' },
            { key: 'invoiceTotal', label: `Ödenecek tutar, KDV dahil (${symbol})`, type: 'number', placeholder: 'Boşsa Tutar' },
            { key: 'dueDate', label: 'Vade tarihi', type: 'date' },
            { key: 'paidDate', label: 'Ödeme tarihi', type: 'date' },
          ]}
          toForm={(x) => ({
            expenseDate: x.expenseDate,
            amount: num(x.amount),
            department: x.department ?? '',
            project: x.project ?? '',
            category: x.category,
            regionId: num(x.regionId),
            description: x.description ?? '',
            supplier: x.supplier ?? '',
            invoiceNo: x.invoiceNo ?? '',
            invoiceTotal: num(x.invoiceTotal),
            dueDate: x.dueDate ?? '',
            paidDate: x.paidDate ?? '',
          })}
        />
      )}

      {tab === 'payments' && (
        <ResourceManager
          resource="payments"
          title="Tahsilatlar"
          description="Müşterilerden alınan ödemeler. Cari hesap bakiyesi ve vadesi geçen alacaklar bunlarla hesaplanır; ödeme müşterinin en eski açık faturasından başlayarak kapatılır. Toplu yükleme için Excel şablonundaki Tahsilatlar sayfasını kullanın."
          noun="tahsilat"
          label={(p) => `${p.customerName} ${formatDate(p.paymentDate)} ${p.reference ?? ''}`}
          blocker={(customers.data ?? []).length === 0 ? blocker('Önce müşteri ekleyin.') : undefined}
          columns={[
            { label: 'Tarih', render: (p) => formatDate(p.paymentDate) },
            { label: 'Müşteri', render: (p) => <>{p.customerName}{(p.method || p.reference) && <div className="cell-sub">{[p.method, p.reference].filter(Boolean).join(' · ')}</div>}</> },
            { label: 'Tutar', render: (p) => money(p.amount), align: 'right' },
          ]}
          fields={[
            { key: 'customerId', label: 'Müşteri', type: 'select', required: true, options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
            { key: 'paymentDate', label: 'Tarih', type: 'date', required: true },
            { key: 'amount', label: `Tutar (${symbol})`, type: 'number', required: true },
            { key: 'method', label: 'Yöntem', type: 'select', options: ['Havale/EFT', 'Nakit', 'Çek', 'Senet', 'Kredi kartı'].map((m) => ({ value: m, label: m })) },
            { key: 'reference', label: 'Belge no', type: 'text', placeholder: 'Dekont, makbuz, çek no' },
            { key: 'description', label: 'Açıklama', type: 'text', wide: true },
          ]}
          toForm={(p) => ({
            customerId: String(p.customerId),
            paymentDate: p.paymentDate,
            amount: num(p.amount),
            method: p.method ?? '',
            reference: p.reference ?? '',
            description: p.description ?? '',
          })}
        />
      )}

      {tab === 'regions' && (
        <ResourceManager
          resource="regions"
          title="Bölgeler"
          description="Satış yaptığınız bölgeler veya depolarınız. Stok ve satışlar bölge bazında analiz edilir."
          noun="bölge"
          label={(r) => r.name}
          onChanged={reloadLookups}
          columns={[
            { label: 'Bölge', render: (r) => r.name },
            { label: 'Müşteri sayısı', render: (r) => formatNumber(r.customerCount), align: 'right' },
          ]}
          fields={[{ key: 'name', label: 'Bölge adı', type: 'text', required: true, placeholder: 'İstanbul' }]}
          toForm={(r) => ({ name: r.name })}
        />
      )}

      {tab === 'employees' && (
        <ResourceManager
          resource="employees"
          title="Çalışanlar"
          description="Opsiyonel. Satış temsilcilerini müşterilere atarsanız, kayıp riski önerilerinde ilgili temsilcinin adı geçer."
          noun="çalışan"
          label={(e) => e.fullName}
          onChanged={reloadLookups}
          columns={[
            { label: 'Ad soyad', render: (e) => <>{e.fullName}<div className="cell-sub">{e.role}</div></> },
            { label: 'Bölge', render: (e) => e.regionName ?? '—' },
            { label: 'Aylık maaş', render: (e) => money(e.monthlySalary), align: 'right' },
            { label: 'İşe başlama', render: (e) => formatDate(e.hireDate), align: 'right' },
          ]}
          fields={[
            { key: 'fullName', label: 'Ad soyad', type: 'text', required: true },
            { key: 'role', label: 'Görev', type: 'text', required: true, placeholder: 'Satış Temsilcisi' },
            { key: 'regionId', label: 'Bölge', type: 'select', options: regionOptions },
            { key: 'monthlySalary', label: `Aylık maaş (${symbol})`, type: 'number', required: true },
            { key: 'hireDate', label: 'İşe başlama tarihi', type: 'date' },
          ]}
          toForm={(e) => ({ fullName: e.fullName, role: e.role, regionId: num(e.regionId), monthlySalary: num(e.monthlySalary), hireDate: e.hireDate })}
        />
      )}
    </>
  )
}

/** Verilerin girildiği para birimi. Değiştirmek tutarları çevirmez; yalnızca hangi para biriminde olduklarını belirtir. */
function BaseCurrencySetting() {
  const { base, currencies, setBase } = useCurrency()
  const [saving, setSaving] = useState(false)

  async function change(code: string) {
    const label = currencies.find((c) => c.code === code)?.label ?? code
    const ok = window.confirm(
      `Verilerinizin para birimi "${label}" olarak kaydedilecek. Mevcut tutarlar çevrilmez; yalnızca ${label} cinsinden ` +
        'girildikleri kabul edilir. Devam edilsin mi?',
    )
    if (!ok) return
    setSaving(true)
    try {
      await setBase(code)
    } catch (error) {
      window.alert(toApiError(error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="field" style={{ minWidth: 220 }} title="Fiyat, maliyet ve giderleri hangi para biriminde giriyorsunuz?">
      <span>Verilerin para birimi</span>
      <select className="input" value={base} disabled={saving} onChange={(e) => void change(e.target.value)}>
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.label}
          </option>
        ))}
      </select>
    </label>
  )
}
