import { useState } from 'react'
import { getRecommendations } from '../api'
import { StatCard, StatGridSkeleton } from '../components/StatCard'
import { AsyncContent, EmptyState } from '../components/states'
import { Badge, ChipFilter, PageHeader, Panel } from '../components/ui'
import { useApi } from '../hooks/useApi'
import type { InsightKind, Priority, Recommendation, RecommendationsResponse } from '../types'
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format'
import { KIND_LABELS, KIND_TONES, PRIORITY_LABELS, PRIORITY_TONES } from '../utils/labels'

type SourceFilter = 'all' | InsightKind
type PriorityFilter = 'all' | Priority

export default function RecommendationsPage() {
  const state = useApi(getRecommendations)

  return (
    <>
      <PageHeader
        title="Öneriler"
        description="Risk, fırsat ve müşteri kaybı tespitlerinin tek listede birleşmiş hali. Öncelik, tahmini finansal etkinin aylık ciroya oranıyla belirlenir."
      />
      <AsyncContent state={state} skeleton={<StatGridSkeleton count={4} />}>
        {(data) => <RecommendationsContent data={data} />}
      </AsyncContent>
    </>
  )
}

function RecommendationsContent({ data }: { data: RecommendationsResponse }) {
  const [source, setSource] = useState<SourceFilter>('all')
  const [priority, setPriority] = useState<PriorityFilter>('all')
  const { counts } = data

  const items = data.items.filter(
    (item) => (source === 'all' || item.source === source) && (priority === 'all' || item.priority === priority),
  )

  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <StatCard label="Toplam aksiyon" value={counts.total} hint={`aylık ciro: ${formatCompactCurrency(data.monthlyRevenue)}`} tone="accent" />
        <StatCard label="Yüksek öncelik" value={counts.high} hint="etki ≥ aylık cironun %3'ü" tone="risk" />
        <StatCard label="Orta öncelik" value={counts.medium} hint="etki ≥ %1" tone="warning" />
        <StatCard label="Düşük öncelik" value={counts.low} tone="muted" />
      </div>

      <div className="page-header" style={{ marginBottom: 0 }}>
        <ChipFilter
          label="Kaynağa göre filtrele"
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'Tüm kaynaklar', count: counts.total },
            { value: 'risk', label: KIND_LABELS.risk, count: counts.bySource.risk },
            { value: 'opportunity', label: KIND_LABELS.opportunity, count: counts.bySource.opportunity },
            { value: 'churn', label: KIND_LABELS.churn, count: counts.bySource.churn },
          ]}
        />
        <ChipFilter
          label="Önceliğe göre filtrele"
          value={priority}
          onChange={setPriority}
          options={[
            { value: 'all', label: 'Tüm öncelikler' },
            { value: 'high', label: PRIORITY_LABELS.high, count: counts.high },
            { value: 'medium', label: PRIORITY_LABELS.medium, count: counts.medium },
            { value: 'low', label: PRIORITY_LABELS.low, count: counts.low },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState title={counts.total === 0 ? 'Açık aksiyon yok' : 'Bu filtreye uyan öneri yok'} />
        </Panel>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {items.map((item) => (
            <RecommendationRow key={item.id} item={item} rank={data.items.indexOf(item) + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function RecommendationRow({ item, rank }: { item: Recommendation; rank: number }) {
  const tone = PRIORITY_TONES[item.priority]
  return (
    <article className={`panel insight-card tone-${tone}`}>
      <div className="insight-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className="badge tone-neutral" style={{ color: 'var(--text-muted)' }}>
            #{rank}
          </span>
          <div>
            <h3 className="insight-title">{item.title}</h3>
            <div className="insight-subtitle">
              {item.entity.type === 'customer' ? 'Müşteri' : 'Ürün'}: {item.entity.name}
              {item.regionName && ` · ${item.regionName}`}
            </div>
          </div>
        </div>
        <div className="insight-badges">
          <Badge tone={tone} dot>
            {PRIORITY_LABELS[item.priority]} öncelik
          </Badge>
          <Badge tone={KIND_TONES[item.source]}>{KIND_LABELS[item.source]}</Badge>
        </div>
      </div>

      <p className="insight-message">{item.situation}</p>

      <div className="recommendation-box">
        <div>
          <strong>Aksiyon: </strong>
          {item.action}
        </div>
      </div>

      <div className="impact">
        <span>
          {item.impactLabel}: <b>{formatCurrency(item.impactAmount)}</b>
        </span>
        <span>aylık cironun {formatPercent(item.impactShare, { digits: 1 })} kadarı</span>
      </div>
    </article>
  )
}
