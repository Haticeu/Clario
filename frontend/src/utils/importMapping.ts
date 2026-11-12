import type { ImportAnalysis, ImportMapping, ImportTypeInfo } from '../types'

/** Bir sayfa türünün eşleşmemiş zorunlu alanları (backend'deki kuralın aynısı). */
export function missingFields(type: ImportTypeInfo, columns: Record<string, string>): string[] {
  const mapped = new Set(Object.values(columns))
  const label = (key: string) => type.fields.find((f) => f.key === key)?.label ?? key
  const missing = type.fields.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.label)
  for (const group of type.requireAny) {
    if (!group.some((key) => mapped.has(key))) missing.push(group.map(label).join(' veya '))
  }
  return missing
}

/** Önerilen eşleştirmeden başlangıç değeri. */
export function initialMapping(analysis: ImportAnalysis): ImportMapping {
  return {
    sheets: analysis.sheets.map((s) => ({
      name: s.name,
      type: s.type,
      headerRow: s.headerRow,
      columns: s.type ? { ...s.suggestions[s.type] } : {},
    })),
  }
}
