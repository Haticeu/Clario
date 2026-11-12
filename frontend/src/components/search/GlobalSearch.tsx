import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { search as searchApi, toApiError } from '../../api'
import type { SearchResults } from '../../types'
import { formatCurrency, formatDate, formatNumber } from '../../utils/format'
import { openOrder } from '../../utils/overlay'
import { CloseIcon, SearchIcon } from '../icons'

const DEBOUNCE_MS = 220

interface Hit {
  key: string
  group: string
  title: string
  detail: string
  value?: string
  open: () => void
}

/** "#12" veya "12" gibi işlem numaraları tek karakter olsa da aranır */
const searchable = (q: string) => q.length >= 2 || /^#?\d+$/.test(q)

/** Rapor sayfasını ilgili filtreyle açar (tüm zamanlar) */
const reportLink = (params: Record<string, string | number>) =>
  `/reports?${new URLSearchParams({ period: 'all', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })}`

function toHits(results: SearchResults, go: (path: string) => void): Hit[] {
  const money = (v: number) => formatCurrency(v)
  return [
    ...results.customers.map<Hit>((c) => ({
      key: `c${c.id}`,
      group: 'Müşteriler',
      title: c.name,
      detail: `${c.customerType} · ${c.regionName} · ${formatNumber(c.orders)} sipariş${c.lastOrderDate ? ` · son ${formatDate(c.lastOrderDate)}` : ''}`,
      value: money(c.revenue),
      open: () => go(reportLink({ customerId: c.id })),
    })),
    ...results.orders.map<Hit>((o) => ({
      key: `o${o.id}`,
      group: 'İşlemler',
      title: `${o.orderNo ?? `#${o.id}`} · ${o.customerName}`,
      detail: `${formatDate(o.date)} · ${formatNumber(o.items)} kalem${o.project ? ` · ${o.project}` : ''}${o.status === 'cancelled' ? ' · İptal' : ''}`,
      value: money(o.total),
      open: () => openOrder(o.id),
    })),
    ...results.products.map<Hit>((p) => ({
      key: `p${p.id}`,
      group: 'Ürünler',
      title: p.name,
      detail: `${p.sku} · ${p.category} · ${formatNumber(p.quantity)} adet satıldı`,
      value: money(p.revenue),
      open: () => go(reportLink({ productId: p.id })),
    })),
    ...results.categories.map<Hit>((c) => ({
      key: `k${c.name}`,
      group: 'Kategoriler',
      title: c.name,
      detail: `${formatNumber(c.products)} ürün`,
      value: money(c.revenue),
      open: () => go(reportLink({ category: c.name })),
    })),
    ...results.regions.map<Hit>((r) => ({
      key: `r${r.id}`,
      group: 'Bölgeler',
      title: r.name,
      detail: 'Bölge',
      value: money(r.revenue),
      open: () => go(reportLink({ regionId: r.id })),
    })),
    ...results.groups.map<Hit>((g) => ({
      key: `g${g.kind}${g.name}`,
      group: 'Departman ve projeler',
      title: g.name,
      detail: g.kind === 'project' ? 'Proje' : 'Departman',
      value: money(g.revenue),
      open: () => go(reportLink({ [g.kind]: g.name })),
    })),
    ...results.expenses.map<Hit>((e, i) => ({
      key: `e${i}`,
      group: 'Giderler',
      title: e.description ?? e.category,
      detail: `${e.category}${e.project ? ` · ${e.project}` : ''} · ${e.count > 1 ? `${formatNumber(e.count)} kayıt, son ` : ''}${formatDate(e.lastDate)}`,
      value: money(e.total),
      open: () => go('/data?tab=expenses'),
    })),
  ]
}

/**
 * Üst çubuktaki arama: müşteri, işlem (sipariş no), ürün/kod, kategori, bölge, departman/proje ve giderler.
 * Yazarken sonuçlar gelir; ok tuşları + Enter ile seçilir. Kısayol: "/" veya Ctrl+K.
 * Telefonda simgeye dokununca tam genişlikte açılır.
 */
export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const trimmed = query.trim()

  // Yazma bittikten kısa süre sonra ara; eski sorgunun geç gelen yanıtı yenisini ezmez
  useEffect(() => {
    if (!searchable(trimmed)) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchApi(trimmed, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return
          setResults(data)
          setError(null)
          setActive(0)
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setError(toApiError(err).message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [trimmed])

  // Kısayol: "/" veya Ctrl+K ile aramaya odaklan
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement).closest('input, textarea, select, [contenteditable=true]')
      if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        setOpen(true)
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Dışarı tıklayınca kapanır
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Sorgu kısaltılınca eski sonuçlar gösterilmez
  const current = searchable(trimmed) ? results : null
  const hits = useMemo(() => (current ? toHits(current, (path) => navigate(path)) : []), [current, navigate])

  function choose(hit: Hit) {
    hit.open()
    setOpen(false)
    input.current?.blur()
  }

  function close() {
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }

  function openField() {
    setOpen(true)
    setTimeout(() => input.current?.focus(), 0)
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'Escape') return close()
    if (hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[active]
      if (hit) choose(hit)
    }
  }

  const showPanel = open && trimmed.length > 0
  const activeHit = hits[active]
  let lastGroup = ''

  return (
    <div className={`search${open ? ' open' : ''}`} ref={root}>
      <button type="button" className="search-toggle" aria-label="Ara" title="Ara (/)" onClick={openField}>
        <SearchIcon size={20} />
      </button>
      <div className="search-field">
        <SearchIcon size={17} className="search-icon" />
        <input
          ref={input}
          type="search"
          className="search-input"
          placeholder="Müşteri, sipariş no, ürün, proje ara…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLoading(searchable(e.target.value.trim()))
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={showPanel && activeHit ? `${listId}-${activeHit.key}` : undefined}
          aria-label="Genel arama"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {open && (
          <button type="button" className="search-clear" onClick={close} aria-label="Aramayı kapat" data-back-close>
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="search-panel" id={listId} role="listbox" aria-label="Arama sonuçları">
          {!searchable(trimmed) && <div className="search-empty faint">En az 2 harf yazın.</div>}
          {searchable(trimmed) && loading && !current && <div className="search-empty faint">Aranıyor…</div>}
          {error && searchable(trimmed) && <div className="search-empty faint">{error}</div>}
          {current && !error && !loading && hits.length === 0 && (
            <div className="search-empty faint">
              "{current.query}" için sonuç yok. Müşteri adı, sipariş numarası, ürün kodu veya proje adı deneyin.
            </div>
          )}
          {searchable(trimmed) &&
            hits.map((hit, i) => {
              const header = hit.group !== lastGroup ? hit.group : null
              lastGroup = hit.group
              return (
                <div key={hit.key}>
                  {header && <div className="search-group">{header}</div>}
                  <div
                    id={`${listId}-${hit.key}`}
                    role="option"
                    aria-selected={i === active}
                    className={`search-hit${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(hit)}
                  >
                    <div className="search-hit-main">
                      <div className="search-hit-title">{hit.title}</div>
                      <div className="search-hit-detail faint">{hit.detail}</div>
                    </div>
                    {hit.value && <div className="search-hit-value">{hit.value}</div>}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
