import { useEffect, useMemo, useState } from 'react'
import type { ReportOptions } from '../../types'
import { formatDate } from '../../utils/format'
import { FILTER_KEYS, MONTH_NAMES, PERIOD_PRESETS, resolvePeriod, todayLocal, type FilterKey } from '../../utils/reportPeriod'
import { CloseIcon } from '../icons'

type Update = (changes: Record<string, string | null>) => void

const STATUS_LABELS: Record<string, string> = { delivered: 'Teslim edilenler', cancelled: 'İptal edilenler', all: 'Tümü' }
const PERIOD_KEYS = ['period', 'year', 'month', 'from', 'to'] as const
const ALL_KEYS = [...PERIOD_KEYS, ...FILTER_KEYS]
/** Hızlı dönem düğmeleri (üst çubukta) */
const QUICK_PERIODS = ['all', 'this-month', 'last-month', 'last-30', 'last-90', 'this-year', 'last-year']
/** Bu kadar seçenekten fazlası varsa listede arama kutusu çıkar */
const SEARCH_THRESHOLD = 8

interface Choice {
  value: string
  label: string
  hint?: string
}

interface Section {
  key: FilterKey
  title: string
  choices: Choice[]
  allLabel: string
}

function sectionsFor(options: ReportOptions, draft: URLSearchParams): Section[] {
  const category = draft.get('category')
  const products = category ? options.products.filter((p) => p.category === category) : options.products
  const none = { value: options.noneValue, label: 'Atanmamış' }
  const list: Section[] = [
    { key: 'category', title: 'Kategori', allLabel: 'Tüm kategoriler', choices: options.categories.map((c) => ({ value: c, label: c })) },
    {
      key: 'productId',
      title: 'Ürün',
      allLabel: category ? `${category} kategorisindeki tüm ürünler` : 'Tüm ürünler',
      choices: products.map((p) => ({ value: String(p.id), label: p.name, hint: category ? undefined : p.category })),
    },
    { key: 'customerId', title: 'Müşteri', allLabel: 'Tüm müşteriler', choices: options.customers.map((c) => ({ value: String(c.id), label: c.name })) },
    { key: 'customerType', title: 'Müşteri tipi', allLabel: 'Tüm tipler', choices: options.customerTypes.map((t) => ({ value: t, label: t })) },
    { key: 'regionId', title: 'Bölge', allLabel: 'Tüm bölgeler', choices: options.regions.map((r) => ({ value: String(r.id), label: r.name })) },
  ]
  if (options.departments.length) list.push({ key: 'department', title: 'Departman', allLabel: 'Tüm departmanlar', choices: [...options.departments.map((d) => ({ value: d, label: d })), none] })
  if (options.projects.length) list.push({ key: 'project', title: 'Proje', allLabel: 'Tüm projeler', choices: [...options.projects.map((p) => ({ value: p, label: p })), none] })
  list.push({
    key: 'status',
    title: 'Sipariş durumu',
    allLabel: STATUS_LABELS.delivered!,
    choices: [
      { value: 'cancelled', label: STATUS_LABELS.cancelled! },
      { value: 'all', label: STATUS_LABELS.all! },
    ],
  })
  return list
}

/** Seçili dönemin kısa adı: "Geçen ay", "2025", "Mart 2026", "01.03 – 15.03.2026" */
function periodLabel(params: URLSearchParams): string {
  const preset = params.get('period') ?? 'all'
  const today = todayLocal()
  if (preset === 'year') return params.get('year') ?? today.slice(0, 4)
  if (preset === 'month') {
    const month = Number(params.get('month') ?? Number(today.slice(5, 7)) - 1)
    return `${MONTH_NAMES[month]} ${params.get('year') ?? today.slice(0, 4)}`
  }
  if (preset === 'custom') {
    const { from, to } = resolvePeriod(params)
    return from && to ? `${formatDate(from)} – ${formatDate(to)}` : 'Tarih aralığı'
  }
  return PERIOD_PRESETS.find((p) => p.value === preset)?.label ?? 'Tüm zamanlar'
}

/**
 * Raporlar filtresi (e-ticaret uygulamalarındaki gibi): üstte hızlı dönem düğmeleri, "Filtrele" ve seçili
 * filtrelerin silinebilir etiketleri; "Filtrele" bölümlere ayrılmış bir panel açar (telefonda tam ekran).
 * Panelde yapılan seçimler "Sonuçları göster" ile uygulanır.
 */
export function ReportFilters({ options, params, update }: { options: ReportOptions; params: URLSearchParams; update: Update }) {
  const [open, setOpen] = useState(false)
  const preset = params.get('period') ?? 'all'
  const sections = sectionsFor(options, params)
  const active = FILTER_KEYS.filter((key) => params.get(key))
  const count = active.length + (preset !== 'all' ? 1 : 0)

  const labelOf = (key: FilterKey) => {
    const value = params.get(key)!
    const section = sections.find((s) => s.key === key)
    return section?.choices.find((c) => c.value === value)?.label ?? value
  }
  const clearAll = () => update(Object.fromEntries(ALL_KEYS.map((k) => [k, null])))

  return (
    <div className="rf">
      <div className="rf-bar">
        <button type="button" className={`rf-open${count > 0 ? ' has-active' : ''}`} onClick={() => setOpen(true)}>
          <FilterIcon />
          Filtrele
          {count > 0 && <span className="rf-count">{count}</span>}
        </button>
        <div className="rf-pills" role="group" aria-label="Dönem">
          {QUICK_PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              className={`rf-pill${preset === value ? ' selected' : ''}`}
              aria-pressed={preset === value}
              onClick={() => update({ period: value === 'all' ? null : value, year: null, month: null, from: null, to: null })}
            >
              {PERIOD_PRESETS.find((p) => p.value === value)!.label}
            </button>
          ))}
          {!QUICK_PERIODS.includes(preset) && (
            <button type="button" className="rf-pill selected" onClick={() => setOpen(true)}>
              {periodLabel(params)}
            </button>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <div className="rf-chips">
          {active.map((key) => (
            <span key={key} className="rf-chip">
              <span className="faint">{sections.find((s) => s.key === key)?.title}:</span> {labelOf(key)}
              <button type="button" aria-label={`${labelOf(key)} filtresini kaldır`} onClick={() => update({ [key]: null, ...(key === 'category' ? { productId: null } : {}) })}>
                <CloseIcon size={13} />
              </button>
            </span>
          ))}
          <button type="button" className="link-button rf-clear" onClick={clearAll}>
            Tümünü temizle
          </button>
        </div>
      )}

      {open && <FilterDrawer options={options} params={params} onApply={(next) => { update(next); setOpen(false) }} onClose={() => setOpen(false)} />}
    </div>
  )
}

function FilterIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

/** Bölümlü filtre paneli. Seçimler önce taslakta tutulur, "Sonuçları göster" ile uygulanır. */
function FilterDrawer({
  options,
  params,
  onApply,
  onClose,
}: {
  options: ReportOptions
  params: URLSearchParams
  onApply: (changes: Record<string, string | null>) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => new URLSearchParams(params))
  const [expanded, setExpanded] = useState<string | null>('period')
  const [query, setQuery] = useState('')
  const sections = useMemo(() => sectionsFor(options, draft), [options, draft])
  const preset = draft.get('period') ?? 'all'
  const today = todayLocal()
  const firstYear = Number((options.dataRange.from ?? today).slice(0, 4))
  const lastYear = Math.max(Number(today.slice(0, 4)), Number((options.dataRange.to ?? today).slice(0, 4)))
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  const set = (changes: Record<string, string | null>) =>
    setDraft((current) => {
      const next = new URLSearchParams(current)
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      return next
    })

  const toggle = (id: string) => {
    setExpanded((current) => (current === id ? null : id))
    setQuery('')
  }

  const apply = () => onApply(Object.fromEntries(ALL_KEYS.map((k) => [k, draft.get(k)])))
  const selectedCount = FILTER_KEYS.filter((k) => draft.get(k)).length + (preset !== 'all' ? 1 : 0)

  return (
    <div className="rf-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="rf-drawer" role="dialog" aria-modal="true" aria-label="Filtreler">
        <div className="rf-drawer-head">
          <b>Filtrele</b>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Kapat" data-back-close>
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="rf-drawer-body">
          {/* Dönem */}
          <section className={`rf-section${expanded === 'period' ? ' open' : ''}`}>
            <button type="button" className="rf-section-head" onClick={() => toggle('period')} aria-expanded={expanded === 'period'}>
              <span>Dönem</span>
              <span className="rf-section-value">{periodLabel(draft)}</span>
              <Chevron />
            </button>
            {expanded === 'period' && (
              <div className="rf-section-body">
                <div className="rf-options">
                  {PERIOD_PRESETS.map((p) => (
                    <label key={p.value} className={`rf-option${preset === p.value ? ' selected' : ''}`}>
                      <input type="radio" name="period" checked={preset === p.value} onChange={() => set({ period: p.value === 'all' ? null : p.value })} />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
                {(preset === 'year' || preset === 'month') && (
                  <div className="rf-inline">
                    <label className="field">
                      <span>Yıl</span>
                      <select className="input" value={draft.get('year') ?? today.slice(0, 4)} onChange={(e) => set({ year: e.target.value })}>
                        {years.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </label>
                    {preset === 'month' && (
                      <label className="field">
                        <span>Ay</span>
                        <select className="input" value={draft.get('month') ?? String(Number(today.slice(5, 7)) - 1)} onChange={(e) => set({ month: e.target.value })}>
                          {MONTH_NAMES.map((name, i) => (
                            <option key={name} value={i}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
                {preset === 'custom' && (
                  <div className="rf-inline">
                    <label className="field">
                      <span>Başlangıç</span>
                      <input className="input" type="date" value={draft.get('from') ?? ''} max={draft.get('to') ?? undefined} onChange={(e) => set({ from: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Bitiş</span>
                      <input className="input" type="date" value={draft.get('to') ?? ''} min={draft.get('from') ?? undefined} onChange={(e) => set({ to: e.target.value })} />
                    </label>
                  </div>
                )}
                {options.dataRange.from && (
                  <p className="faint rf-note">
                    Verideki tarih aralığı: {formatDate(options.dataRange.from)} – {formatDate(options.dataRange.to!)}
                  </p>
                )}
              </div>
            )}
          </section>

          {sections.map((section) => {
            const value = draft.get(section.key)
            const isOpen = expanded === section.key
            const searchable = section.choices.length > SEARCH_THRESHOLD
            const q = query.trim().toLocaleLowerCase('tr-TR')
            const visible = q ? section.choices.filter((c) => c.label.toLocaleLowerCase('tr-TR').includes(q)) : section.choices
            return (
              <section key={section.key} className={`rf-section${isOpen ? ' open' : ''}`}>
                <button type="button" className="rf-section-head" onClick={() => toggle(section.key)} aria-expanded={isOpen}>
                  <span>{section.title}</span>
                  <span className={`rf-section-value${value ? ' active' : ''}`}>{value ? section.choices.find((c) => c.value === value)?.label ?? value : section.allLabel}</span>
                  <Chevron />
                </button>
                {isOpen && (
                  <div className="rf-section-body">
                    {searchable && (
                      <input className="input rf-search" type="search" placeholder={`${section.title} ara…`} value={query} onChange={(e) => setQuery(e.target.value)} />
                    )}
                    <div className="rf-options">
                      {!q && (
                        <label className={`rf-option${!value ? ' selected' : ''}`}>
                          <input type="radio" name={section.key} checked={!value} onChange={() => set({ [section.key]: null, ...(section.key === 'category' ? { productId: null } : {}) })} />
                          <span>{section.allLabel}</span>
                        </label>
                      )}
                      {visible.map((choice) => (
                        <label key={choice.value} className={`rf-option${value === choice.value ? ' selected' : ''}`}>
                          <input
                            type="radio"
                            name={section.key}
                            checked={value === choice.value}
                            onChange={() => set({ [section.key]: choice.value, ...(section.key === 'category' ? { productId: null } : {}) })}
                          />
                          <span>
                            {choice.label}
                            {choice.hint && <small>{choice.hint}</small>}
                          </span>
                        </label>
                      ))}
                      {visible.length === 0 && <div className="faint rf-note">Sonuç yok</div>}
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <div className="rf-drawer-foot">
          <button type="button" className="button" onClick={() => setDraft(new URLSearchParams())} disabled={selectedCount === 0}>
            Temizle
          </button>
          <button type="button" className="button button-primary" onClick={apply}>
            Sonuçları göster
          </button>
        </div>
      </aside>
    </div>
  )
}

function Chevron() {
  return (
    <svg className="rf-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
