export interface CurrencyOption {
  code: string
  label: string
  symbol: string
}

/** GET /api/settings */
export interface AppSettings {
  /** Verilerin girildiği para birimi */
  baseCurrency: string
  currencies: CurrencyOption[]
}

/** GET /api/currency — isteğin para birimi bağlamı */
export interface CurrencyInfo {
  base: string
  display: string
  /** 1 birim ana para biriminin gösterim para birimindeki karşılığı */
  rate: number
  rateDate: string | null
  source: string | null
}
