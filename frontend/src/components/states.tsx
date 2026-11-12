import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ApiError } from '../api'
import { DatabaseIcon, InboxIcon, RefreshIcon, RiskIcon } from './icons'

export function LoadingState({ label = 'Veriler analiz ediliyor…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="stack" aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="panel" style={{ padding: 18 }}>
          <div className="skeleton" style={{ width: '35%', height: 14 }} />
          <div className="skeleton" style={{ width: '90%', height: 12, marginTop: 14 }} />
          <div className="skeleton" style={{ width: '75%', height: 12, marginTop: 8 }} />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  title = 'Gösterilecek veri yok',
  description,
  icon,
}: {
  title?: string
  description?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="state">
      <div className="state-icon">{icon ?? <InboxIcon size={22} />}</div>
      <div className="state-title">{title}</div>
      {description && <div className="state-text">{description}</div>}
    </div>
  )
}

/** Henüz hiç satış verisi yokken: kullanıcıyı veri girişine yönlendirir. */
export function NoDataState({ description }: { description?: ReactNode }) {
  return (
    <div className="panel">
      <div className="state tone-accent">
        <div className="state-icon">
          <DatabaseIcon size={22} />
        </div>
        <div className="state-title">Henüz veri yok</div>
        <div className="state-text">
          {description ??
            'Bu analiz, satış verileriniz girildiğinde otomatik olarak oluşur. Verilerinizi Excel ile toplu yükleyebilir veya tek tek ekleyebilirsiniz.'}
        </div>
        <div className="form-actions" style={{ justifyContent: 'center' }}>
          <Link className="button button-primary" to="/data?tab=import">
            Excel ile yükle
          </Link>
          <Link className="button" to="/data?tab=products">
            Elle ekle
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  if (error.status === 503) return <NoDataState />
  return (
    <div className="panel" role="alert">
      <div className="state tone-risk">
        <div className="state-icon">
          <RiskIcon size={22} />
        </div>
        <div className="state-title">Veriler yüklenemedi</div>
        <div className="state-text">{error.message}</div>
        {onRetry && (
          <button type="button" className="button" onClick={onRetry} style={{ marginTop: 8 }}>
            <RefreshIcon size={15} /> Tekrar dene
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Bir API isteğinin durumuna göre yükleme iskeleti, hata mesajı veya içeriği gösterir.
 * `children` yalnızca veri geldiğinde çağrılır; böylece içerik tarafında null kontrolü gerekmez.
 */
export function AsyncContent<T>({
  state,
  skeleton,
  children,
}: {
  state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }
  skeleton?: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />
  if (state.loading || state.data === null) return <>{skeleton ?? <LoadingState />}</>
  return <>{children(state.data)}</>
}
