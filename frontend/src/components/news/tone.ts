import type { NewsItem } from '../../types'
import type { Tone } from '../../utils/labels'

/** Maliyeti artıran/talebi düşüren gelişmeler uyarı, tersi fırsat tonunda */
export function newsTone(item: NewsItem): Tone {
  const costUp = ['interest', 'currency', 'inflation', 'energy', 'commodities', 'wages', 'tax'].includes(item.theme)
  if (item.theme === 'disaster' || (item.theme === 'supply' && item.direction === 'up')) return 'risk'
  if (item.direction === null) return 'accent'
  if (costUp) return item.direction === 'up' ? 'warning' : 'opportunity'
  return item.direction === 'up' ? 'opportunity' : 'warning'
}
