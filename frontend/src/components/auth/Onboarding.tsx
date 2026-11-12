import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toApiError, updateMe } from '../../api'
import { useAuth } from '../../auth'
import { useCurrency } from '../../currency'
import { BellIcon } from '../icons'
import { AssistantOrb } from '../AssistantOrb'
import { countryName } from '../../utils/countries'

const STEPS = ['Hoş geldiniz', 'Para birimi', 'Gündem', 'Veriler'] as const

const HIGHLIGHTS = [
  { title: 'Riskler', text: 'Satışı düşen, stoğu fazla veya bitmek üzere olan ürünler; kaybedilmek üzere olan müşteriler.' },
  { title: 'Fırsatlar', text: 'Talebi anlamlı biçimde artan ürün ve bölgeler, bölgeler arası stok transfer önerileri.' },
  { title: 'Öneriler', text: 'Hepsi etkisine göre sıralanmış net aksiyonlar: önce ne yapmalı?' },
]

/**
 * İlk girişte kurulum: tanıtım → verilerin para birimi → yapay zekâ bağlantısı (atlanabilir) → veri girişi.
 * Bitince bir daha gösterilmez; aynı ayarlar sonradan Ayarlar sayfasından değiştirilebilir.
 */
export function Onboarding() {
  const { me, refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstName = me.name?.split(' ')[0]

  async function finish(target: string) {
    setFinishing(true)
    setError(null)
    try {
      await updateMe({ onboardingCompleted: true })
      navigate(target)
      await refresh()
    } catch (err) {
      setError(toApiError(err).message)
      setFinishing(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card panel">
        <ol className="onboarding-steps" aria-label="Kurulum adımları">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'current' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span className="onboarding-dot">{i < step ? '✓' : i + 1}</span>
              <span className="onboarding-step-label">{label}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="onboarding-body">
            <div className="onboarding-hero">
              <AssistantOrb size={88} state="happy" />
              <div>
                <h1 className="onboarding-title">{firstName ? `Hoş geldiniz, ${firstName}!` : 'Clario\'ya hoş geldiniz!'}</h1>
                <p className="muted">
                  Clario satış, stok, müşteri ve gider verinizi analiz eder; sorunları ve fırsatları bulup ne yapmanız gerektiğini söyler.
                  Kurulum iki dakika sürer.
                </p>
              </div>
            </div>
            <div className="onboarding-highlights">
              {HIGHLIGHTS.map((h) => (
                <div key={h.title} className="onboarding-highlight">
                  <b>{h.title}</b>
                  <span>{h.text}</span>
                </div>
              ))}
            </div>
            <div className="alert tone-accent" style={{ marginTop: 0 }}>
              🔒 Verileriniz yalnızca bu hesaba aittir ve parolanızdan türetilen anahtarla (AES-256) şifrelenerek saklanır.
            </div>
          </section>
        )}

        {step === 1 && <CurrencyStep />}

        {step === 2 && (
          <section className="onboarding-body">
            <div className="onboarding-hero">
              <span className="onboarding-bell">
                <BellIcon size={34} />
              </span>
              <div>
                <h2 className="onboarding-title">Gündem ve bildirimler</h2>
                <p className="muted">
                  Clario ekonomi haberlerini ve döviz kurlarını takip eder; faiz, kur, enflasyon, enerji fiyatları veya bölgenizdeki bir
                  gelişme işletmenizi etkileyebilecekse sağ üstteki <b>zil</b> simgesinde ve Genel Bakış'ta bildirir.
                </p>
              </div>
            </div>
            <div className="onboarding-highlight">
              <b>Örnek</b>
              <span>
                "Merkez Bankası faizi artırdı" → Finansman maliyeti artabilir; fazla stokta bağlı sermayenizin maliyeti yükselir. Öneri: fazla
                stoğu eritmeye öncelik verin.
              </span>
            </div>
            <p className="faint" style={{ fontSize: 12.5 }}>
              Yorumlar haber başlıklarından Clario'nun kendi kurallarıyla çıkarılır ve sizin verinizle ilişkilendirilir; olasılık belirtir,
              kesin tahmin değildir. Hiçbir veriniz dışarı gönderilmez.
            </p>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-body">
            <h2 className="onboarding-title">Son adım: verilerinizi ekleyin</h2>
            <p className="muted">Analizler en az 2–3 aylık satış geçmişiyle anlamlı sonuç verir. En hızlısı Excel ile yüklemek.</p>
            <div className="onboarding-choices">
              <button type="button" className="onboarding-choice" disabled={finishing} onClick={() => void finish('/data?tab=import')}>
                <b>Excel ile yükle</b>
                <span>Kendi tablonuzu veya Clario şablonunu yükleyin; sütunlar otomatik eşleştirilir.</span>
              </button>
              <button type="button" className="onboarding-choice" disabled={finishing} onClick={() => void finish('/data?tab=products')}>
                <b>Elle ekle</b>
                <span>Ürün, müşteri ve satışları formlarla tek tek girin.</span>
              </button>
              <button type="button" className="onboarding-choice" disabled={finishing} onClick={() => void finish('/')}>
                <b>Sonra</b>
                <span>Önce uygulamayı gezin; Veri Yönetimi'nden istediğiniz zaman ekleyebilirsiniz.</span>
              </button>
            </div>
            {error && <div className="alert tone-risk">{error}</div>}
          </section>
        )}

        <div className="onboarding-nav">
          {step > 0 ? (
            <button type="button" className="button" onClick={() => setStep(step - 1)} disabled={finishing}>
              ← Geri
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 && (
            <button type="button" className="button button-primary" onClick={() => setStep(step + 1)}>
              {step === 0 ? 'Başlayalım →' : 'Devam →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CurrencyStep() {
  const { me } = useAuth()
  const { base, currencies, setBase } = useCurrency()
  const [error, setError] = useState<string | null>(null)
  const current = currencies.find((c) => c.code === base)

  async function choose(code: string) {
    setError(null)
    try {
      await setBase(code)
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <section className="onboarding-body">
      <h2 className="onboarding-title">Verilerinizin para birimi</h2>
      <p className="muted">
        {me.country ? `Ülkeniz ${countryName(me.country)} olduğu için` : 'Ülkenize göre'} fiyat, maliyet ve giderler{' '}
        <b>
          {current?.label} ({current?.symbol})
        </b>{' '}
        olarak girilecek. Farklı bir para biriminde çalışıyorsanız değiştirin. Analizleri daha sonra istediğiniz para biriminde
        görebilirsiniz; her kayıt kendi tarihindeki kurla çevrilir.
      </p>
      <div className="currency-hero">
        <span className="currency-hero-symbol">{current?.symbol}</span>
        <div>
          <div className="provider-name">{current?.label}</div>
          <div className="faint">{base}</div>
        </div>
        <label className="field" style={{ marginLeft: 'auto', minWidth: 220 }}>
          <span>Değiştir</span>
          <select className="input" value={base} onChange={(e) => void choose(e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="alert tone-risk">{error}</div>}
    </section>
  )
}
