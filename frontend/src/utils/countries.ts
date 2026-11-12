import type { CountryOption } from '../types'

const regionNames = new Intl.DisplayNames('tr', { type: 'region' })
const currencyNames = new Intl.DisplayNames('tr', { type: 'currency' })

/** 'TR' → 'Türkiye' */
export const countryName = (code: string) => regionNames.of(code) ?? code

/** 'EUR' → 'Euro' */
export const currencyName = (code: string) => currencyNames.of(code) ?? code

/** Ülkeler Türkçe adlarına göre sıralı */
export function sortCountries(countries: CountryOption[]): CountryOption[] {
  return [...countries].sort((a, b) => countryName(a.code).localeCompare(countryName(b.code), 'tr'))
}

/** Tarayıcı dilinden ülke tahmini (ör. "tr-TR" → TR, "de-DE" → DE); bulunamazsa Türkiye. */
export function guessCountry(countries: CountryOption[]): string {
  const codes = new Set(countries.map((c) => c.code))
  for (const language of navigator.languages ?? [navigator.language]) {
    const region = language.split('-')[1]?.toUpperCase()
    if (region && codes.has(region)) return region
  }
  return codes.has('TR') ? 'TR' : (countries[0]?.code ?? '')
}
