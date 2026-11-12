import { useState, type FormEvent, type ReactNode } from 'react'
import { getAuthStatus, getGooglePending, GOOGLE_START_URL, login, recoverAccount, register, toApiError } from '../../api'
import { passwordRules } from '../../auth'
import { useApi } from '../../hooks/useApi'
import { guessCountry } from '../../utils/countries'
import { native } from '../../utils/native'
import { CountryField } from './CountryField'
import { GoogleButton, GoogleStep } from './GoogleStep'
import { PasswordField } from './PasswordField'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'

type Mode = 'login' | 'register' | 'recover'

const TITLES: Record<Mode, { title: string; subtitle: string }> = {
  login: { title: 'Giriş yapın', subtitle: 'Hesabınıza giriş yaptığınızda şifreli verileriniz açılır.' },
  register: { title: 'Hesap oluşturun', subtitle: 'Verileriniz parolanızla şifrelenir; yalnızca siz açabilirsiniz.' },
  recover: { title: 'Parolanızı mı unuttunuz?', subtitle: 'Kayıt olurken aldığınız kurtarma anahtarıyla yeni parola belirleyin.' },
}

const FEATURES = [
  { title: 'Riskleri erken görün', text: 'Satışı düşen ürünler, fazla stok ve kaybedilmek üzere olan müşteriler.' },
  { title: 'Fırsatları kaçırmayın', text: 'Talebi artan bölgeler ve stok transfer önerileri.' },
  { title: 'Asistana sorun', text: '"Bu ay neden satışlar düştü?" — cevap gerçek verinizden gelir.' },
  { title: 'Verileriniz sizde, şifreli', text: 'Her hesabın verisi ayrı dosyada, AES-256 ile şifrelenmiş olarak durur.' },
]

const GOOGLE_ERRORS: Record<string, string> = {
  denied: 'Google girişi iptal edildi.',
  state: 'Google girişinin süresi doldu veya başka bir pencerede başlatıldı. Tekrar deneyin.',
  unverified: 'Google hesabınızın e-posta adresi doğrulanmamış; bu hesapla giriş yapılamaz.',
  failed: 'Google girişi tamamlanamadı. Tekrar deneyin.',
}

/** Google'dan hata koduyla dönüldüyse mesajı alır ve adres çubuğunu temizler. */
function takeGoogleError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('googleError')
  if (!code) return null
  params.delete('googleError')
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
  return GOOGLE_ERRORS[code] ?? GOOGLE_ERRORS.failed!
}

/** Giriş, kayıt ve kurtarma anahtarıyla parola yenileme. Başarılı olunca onAuthenticated çağrılır. */
export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const status = useApi(getAuthStatus)
  const google = useApi(getGooglePending)
  const [modeChoice, setModeChoice] = useState<Mode | null>(null)
  // Telefonda bu cihazda henüz hesap yoksa doğrudan kayıt ekranı açılır
  const mode: Mode = modeChoice ?? (status.data?.device && status.data.hasAccounts === false ? 'register' : 'login')
  const deviceNote = status.data?.device && mode !== 'recover'
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [countryChoice, setCountryChoice] = useState<string | null>(null)
  const countries = status.data?.countries ?? []
  // Seçim yapılmadıysa tarayıcı dilinden tahmin edilir (ör. tr-TR → Türkiye)
  const country = countryChoice ?? (countries.length ? guessCountry(countries) : '')
  const [password, setPassword] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error, setError] = useState<string | null>(takeGoogleError)
  const [busy, setBusy] = useState(false)
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null)

  const minLength = status.data?.passwordMinLength ?? 10
  const needsStrongPassword = mode !== 'login'
  const passwordOk = !needsStrongPassword || passwordRules(password, minLength).every((r) => r.ok)
  const profileOk = mode !== 'register' || (name.trim().length >= 2 && country !== '')

  function switchMode(next: Mode) {
    setModeChoice(next)
    setError(null)
    setPassword('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
        onAuthenticated()
      } else if (mode === 'register') {
        const user = await register({ email, password, name: name.trim(), country })
        // Kurtarma anahtarı gösterilip kullanıcı kaydettiğini onaylayana kadar uygulamaya geçilmez
        setNewRecoveryKey(user.recoveryKey ?? null)
        if (!user.recoveryKey) onAuthenticated()
      } else {
        await recoverAccount(email, recoveryInput, password)
        onAuthenticated()
      }
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  // Google kimliği doğruladıysa: veri parolası adımı
  if (google.data && !newRecoveryKey) {
    return (
      <AuthLayout>
        <GoogleStep
          pending={google.data}
          minLength={minLength}
          countries={countries}
          defaultCountry={country}
          onAuthenticated={onAuthenticated}
          onCancel={google.reload}
          onForgot={(forgotEmail) => {
            setEmail(forgotEmail)
            switchMode('recover')
            google.reload()
          }}
        />
      </AuthLayout>
    )
  }

  const googleUsable = status.data?.googleEnabled && status.data.googleAppUrl === window.location.origin

  const { title, subtitle } = newRecoveryKey
    ? { title: 'Kurtarma anahtarınız', subtitle: 'Hesabınız oluşturuldu. Devam etmeden önce bu anahtarı kaydedin.' }
    : TITLES[mode]

  return (
    <AuthLayout>
      <h2 className="auth-title">{title}</h2>
      <p className="auth-subtitle">{subtitle}</p>
      {deviceNote && !newRecoveryKey && (
        <div className="alert tone-accent" style={{ marginTop: 0 }}>
          {status.data?.hasAccounts === false ? (
            <>
              Bu telefonda henüz hesap yok. Clario verileri <b>cihazda</b> tutar: bilgisayardaki hesabınız burada geçmez. Bu
              telefon için bir hesap oluşturun (aynı e-postayı kullanabilirsiniz).
            </>
          ) : (
            <>Hesaplar her cihazda ayrıdır: bu telefonda oluşturduğunuz hesapla giriş yapın.</>
          )}
        </div>
      )}

      {!newRecoveryKey && mode !== 'recover' && status.data?.googleEnabled && (
        <>
          {googleUsable ? (
            <GoogleButton href={GOOGLE_START_URL} />
          ) : (
            <div className="alert tone-accent" style={{ marginTop: 0 }}>
              Google ile giriş yalnızca <b>{status.data.googleAppUrl}</b> adresinden açıldığında çalışır. Burada e-posta ve
              parolanızı kullanın.
            </div>
          )}
          <div className="auth-divider">
            <span>veya e-posta ile</span>
          </div>
        </>
      )}
      {renderForm()}
    </AuthLayout>
  )

  // Kart içeriği (başlık hariç): kayıt/giriş/kurtarma formu veya kurtarma anahtarı
  function renderForm() {
    return (
      <>

          {newRecoveryKey ? (
            <RecoveryKeyPanel recoveryKey={newRecoveryKey} onDone={onAuthenticated} doneLabel="Kurulumu başlat" />
          ) : (
            <form className="stack" style={{ gap: 14 }} onSubmit={(e) => void submit(e)}>
              {mode === 'register' && (
                <>
                  <label className="field">
                    <span>Adınız</span>
                    <input className="input" autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <CountryField countries={countries} value={country} onChange={setCountryChoice} showCurrency />
                </>
              )}
              <label className="field">
                <span>E-posta</span>
                <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {mode === 'recover' && (
                <label className="field">
                  <span>Kurtarma anahtarı</span>
                  <input
                    className="input mono"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    placeholder="XXXX-XXXX-XXXX-…"
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                  />
                </label>
              )}
              <PasswordField
                label={mode === 'recover' ? 'Yeni parola' : 'Parola'}
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={needsStrongPassword ? minLength : undefined}
              />
              {error && (
                <div className="alert tone-risk" role="alert" style={{ marginTop: 0 }}>
                  {error}
                </div>
              )}
              <button type="submit" className="button button-primary button-block" disabled={busy || !passwordOk || !profileOk}>
                {busy
                  ? mode === 'register'
                    ? 'Hesap ve şifreleme anahtarı oluşturuluyor…'
                    : 'Kontrol ediliyor…'
                  : mode === 'login'
                    ? 'Giriş yap'
                    : mode === 'register'
                      ? 'Hesap oluştur'
                      : 'Parolayı yenile ve giriş yap'}
              </button>
            </form>
          )}

          {!newRecoveryKey && (
            <div className="auth-switch">
              {mode === 'login' ? (
                <>
                  <button type="button" className="link-button" onClick={() => switchMode('register')}>
                    Hesabınız yok mu? Kayıt olun
                  </button>
                  <button type="button" className="link-button" onClick={() => switchMode('recover')}>
                    Parolamı unuttum
                  </button>
                </>
              ) : (
                <button type="button" className="link-button" onClick={() => switchMode('login')}>
                  ← Giriş ekranına dön
                </button>
              )}
            </div>
          )}
      </>
    )
  }
}

/** Sol: tanıtım, sağ: kart. Giriş ekranının ve Google adımının ortak yerleşimi. */
function AuthLayout({ children }: { children: ReactNode }) {
  const footnote = native()
    ? 'Verileriniz yalnızca bu telefonda, parolanızdan türetilen anahtarla şifrelenmiş olarak saklanır.'
    : 'Verileriniz bu bilgisayardaki Clario sunucusunda, parolanızdan türetilen anahtarla şifrelenmiş olarak saklanır.'
  return (
    <div className="auth-screen">
      <aside className="auth-brand">
        <div className="auth-brand-top">
          <img src="/icon-192.png" alt="" width={44} height={44} />
          <div>
            <div className="auth-brand-name">Clario</div>
            <div className="auth-brand-tagline">Veriden karara</div>
          </div>
        </div>
        <h1 className="auth-headline">İşletmenizin verisini risklere, fırsatlara ve net önerilere çevirin.</h1>
        <ul className="auth-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <b>{f.title}</b>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="auth-main">
        <div className="auth-card panel">{children}</div>
        <p className="auth-footnote">{footnote}</p>
      </main>
    </div>
  )
}
