import type { CSSProperties } from 'react'
import type { ChartPalette } from '../theme'

/** Recharts Tooltip'inin temaya uygun stilleri. */
export function tooltipStyles(chart: ChartPalette): {
  contentStyle: CSSProperties
  labelStyle: CSSProperties
  itemStyle: CSSProperties
} {
  return {
    contentStyle: {
      background: chart.tooltipBg,
      border: `1px solid ${chart.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 13,
      boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
    },
    labelStyle: { color: chart.text, fontWeight: 600, marginBottom: 4 },
    itemStyle: { color: chart.text, padding: 0 },
  }
}
