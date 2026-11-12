import { useState, type FormEvent } from 'react'
import { cancelGoogle, completeGoogle, toApiError } from '../../api'
import { passwordRules } from '../../auth'
import type { CountryOption, GooglePending } from '../../types'
import { CountryField } from './CountryField'
import { PasswordField } from './PasswordField'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'

/** Google'ın marka kurallarına uygun "G" işareti */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Tam sayfa yönlendirme: Google'a gidilir, dönüşte bu ekrana gelinir. */
export function GoogleButton({ href }: { href: string }) {
  return (
    <a className="button google-button button-block" href={href}>
      <GoogleMark /> Google ile devam et
    </a>
  )
}

const COPY: Record<GooglePending['kind'], { title: string; action: string }> = {
  register: { title: 'Veri parolanızı belirleyin', action: 'Hesabı oluştur' },
  unlock: { title: 'Veri parolanızı girin', action: 'Verilerimi aç' },
  link: { title: 'Google hesabınızı bağlayın', action: 'Bağla ve giriş yap' },
}

/**
 * Google kimliği doğruladıktan sonraki adım. Verinin kilidini Google değil, veri parolası açar:
 * Google parolasını Clario hiç görmediği için şifreleme anahtarı ondan türetilemez.
 */
export function GoogleStep({
  pending,
  minLength,
  countries,
  defaultCountry,
  onAuthenticated,
  onCancel,
  onForgot,
}: {
  pending: GooglePending
  minLength: number
  countries: CountryOption[]
  defaultCountry: string
  onAuthenticated: () => void
  onCancel: () => void
  onForgot: (email: string) => void
}) {
  const [password, setPassword] = useState('')
  const [name, setName] = useState(pending.name ?? '')
  const [countryChoice, setCountry] = useState<string | null>(null)
  const country = countryChoice ?? defaultCountry
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const isNew = pending.kind === 'register'
  const copy = COPY[pending.kind]

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await completeGoogle(
        password,
        isNew ? { name: name.trim(), country } : {},
      )
      if (result.recoveryKey) setRecoveryKey(result.recoveryKey)
      else onAuthenticated()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    await cancelGoogle().catch(() => undefined)
    onCancel()
  }

  async function forgot() {
    await cancelGoogle().catch(() => undefined)
    onForgot(pending.email)
  }

  if (recoveryKey) {
    return (
      <>
        <h2 className="auth-title">Kurtarma anahtarınız</h2>
        <p className="auth-subtitle">Hesabınız oluşturuldu. Veri parolanızı unutursanız verilerinizi yalnızca bu anahtar açar.</p>
        <RecoveryKeyPanel recoveryKey={recoveryKey} onDone={onAuthenticated} doneLabel="Kurulumu başlat" />
      </>
    )
  }

  return (
    <>
      <div className="google-identity">
        <GoogleMark />
        <span>
          Google ile doğrulandı: <b>{pending.email}</b>
        </span>
      </div>
      <h2 className="auth-title">{copy.title}</h2>
      <p className="auth-subtitle">
        {pending.kind === 'register' && (
          <>
            Verileriniz şifreli saklanır ve kilidini Google değil, <b>sizin belirleyeceğiniz veri parolası</b> açar (Clario Google
            parolanızı görmez). Google'ın çalışmadığı yerlerde, ör. yerel ağdaki başka bir cihazda, e-postanız ve bu parolayla da
            giriş yapabilirsiniz.
          </>
        )}
        {pending.kind === 'unlock' && 'Verilerinizin kilidini açmak için veri parolanızı girin.'}
        {pending.kind === 'link' &&
          'Bu e-postayla zaten bir Clario hesabınız var. Google\'ı bağlamak için o hesabın parolasını girin; sonraki girişlerde Google ile devam edip aynı parolayı kullanırsınız.'}
      </p>

      <form className="stack" style={{ gap: 14 }} onSubmit={(e) => void submit(e)}>
        {isNew && (
          <>
            <label className="field">
              <span>Adınız</span>
              <input className="input" autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <CountryField countries={countries} value={country} onChange={setCountry} showCurrency />
          </>
        )}
        <PasswordField
          label={pending.kind === 'link' ? 'Hesap parolası' : 'Veri parolası'}
          value={password}
          onChange={setPassword}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          minLength={isNew ? minLength : undefined}
        />
        {error && (
          <div className="alert tone-risk" role="alert" style={{ marginTop: 0 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          className="button button-primary button-block"
          disabled={busy || !password || (isNew && (!passwordRules(password, minLength).every((r) => r.ok) || name.trim().length < 2 || !country))}
        >
          {busy ? (isNew ? 'Hesap ve şifreleme anahtarı oluşturuluyor…' : 'Kontrol ediliyor…') : copy.action}
        </button>
      </form>

      <div className="auth-switch">
        <button type="button" className="link-button" onClick={() => void cancel()}>
          ← Vazgeç
        </button>
        {!isNew && (
          <button type="button" className="link-button" onClick={() => void forgot()}>
            {pending.kind === 'link' ? 'Parolamı unuttum' : 'Veri parolamı unuttum'}
          </button>
        )}
      </div>
    </>
  )
}
