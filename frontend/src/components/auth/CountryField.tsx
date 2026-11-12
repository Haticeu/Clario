import type { CountryOption } from '../../types'
import { countryName, currencyName, sortCountries } from '../../utils/countries'

/**
 * Ülke seçimi. showCurrency: seçilen ülkeye göre verilerin hangi para biriminde tutulacağını gösterir
 * (kayıtta para birimi ülkeden otomatik belirlenir).
 */
export function CountryField({
  countries,
  value,
  onChange,
  showCurrency = false,
}: {
  countries: CountryOption[]
  value: string
  onChange: (code: string) => void
  showCurrency?: boolean
}) {
  const selected = countries.find((c) => c.code === value)
  return (
    <label className="field">
      <span>Ülke</span>
      <select className="input" required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Seçin…
        </option>
        {sortCountries(countries).map((c) => (
          <option key={c.code} value={c.code}>
            {countryName(c.code)}
          </option>
        ))}
      </select>
      {showCurrency && selected && (
        <span className="field-hint">
          {selected.native === selected.currency
            ? `Tutarlar ${currencyName(selected.currency)} (${selected.currency}) olarak tutulur.`
            : `${currencyName(selected.native)} için kur verisi yok; tutarlar ${currencyName(selected.currency)} (${selected.currency}) olarak tutulur.`}{' '}
          Kurulumda değiştirebilirsiniz.
        </span>
      )}
    </label>
  )
}
