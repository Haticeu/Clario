import { useState, type FormEvent } from 'react'
import { getReportSettings, saveReportSettings, changePassword, createRecoveryKey, deleteAccount, getAuthStatus, resetData, toApiError, unlinkGoogle, updateMe } from '../api'
import { notifyDataChanged } from '../utils/dataEvents'
import { CountryField } from '../components/auth/CountryField'
import { PasswordField } from '../components/auth/PasswordField'
import { RecoveryKeyPanel } from '../components/auth/RecoveryKeyPanel'
import { CurrencySelect } from '../components/CurrencySelect'
import { LogoutIcon } from '../components/icons'
import { PageHeader, Panel } from '../components/ui'
import { passwordRules, useAuth } from '../auth'
import { useApi } from '../hooks/useApi'
import { useTheme, type ThemeMode } from '../theme'
import type { ReportSettings } from '../types'
import { native } from '../utils/native'
import { requestWebNotifications, webNotificationState } from '../utils/notifier'

const MIN_PASSWORD = 10

/** Hesap ayarları: görünüm, para birimi, oturum, profil, parola ve kurtarma anahtarı, verileri sıfırlama, hesabı silme. */
export default function SettingsPage() {
  const { me } = useAuth()
  return (
    <>
      <PageHeader title="Ayarlar" description={`Hesap: ${me.email ?? ''}`} />
      <div className="stack">
        <AppearancePanel />
        <div className="grid grid-2">
          <CurrencyPanel />
          <NotificationsPanel />
        </div>
        <div className="grid grid-2">
          <ProfilePanel />
          <PasswordPanel />
        </div>
        <RecoveryPanel />
        <ResetPanel />
        <DeletePanel />
        {/* Çıkış en altta */}
        <SessionPanel />
      </div>
    </>
  )
}

/** Tutarların gösterileceği para birimi (veriler kendi para biriminde kalır, her kayıt kendi tarihindeki kurla çevrilir) */
function CurrencyPanel() {
  return (
    <Panel title="Gösterim para birimi" subtitle="Analiz ve raporlardaki tutarlar bu para biriminde gösterilir">
      <CurrencySelect />
      <p className="faint" style={{ marginTop: 10, fontSize: 13 }}>
        "(veri)" işaretli olan, verilerinizin girildiği para birimidir; onu Veri Yönetimi'nden değiştirebilirsiniz. Diğerlerinde her
        kayıt kendi tarihindeki ECB kuruyla çevrilir.
      </p>
    </Panel>
  )
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** Bildirimler: aylık ekstre (ayın 1'i), gün sonu raporu (seçilen saat), bilgisayarda tarayıcı izni */
function NotificationsPanel() {
  const settings = useApi(getReportSettings)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState(webNotificationState)

  async function save(next: ReportSettings) {
    setError(null)
    try {
      const result = await saveReportSettings(next)
      await native()?.scheduleReports?.(result)
      settings.reload()
      setSaved('Kaydedildi')
      setTimeout(() => setSaved(null), 2000)
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  const data = settings.data
  return (
    <Panel
      title="Bildirimler"
      subtitle={native() ? 'Telefonunuza bildirim olarak gelir; uygulama kapalıyken de' : 'Zilde görünür; izin verirseniz tarayıcı bildirimi olarak da gelir'}
      actions={saved && <span className="faint">{saved}</span>}
    >
      {!data && !settings.error && <div className="faint">Yükleniyor…</div>}
      {settings.error && <div className="alert tone-risk">{settings.error.message}</div>}
      {data && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="settings-toggle">
            <input type="checkbox" checked={data.monthly} onChange={(e) => void save({ ...data, monthly: e.target.checked })} />
            <span>
              Aylık ekstre
              <small>Her ayın 1'inde geçen ayın ekstresi hazır olduğunda (Excel)</small>
            </span>
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={data.daily} onChange={(e) => void save({ ...data, daily: e.target.checked })} />
            <span>
              Gün sonu raporu
              <small>İşlem yapılan günlerde, günün özeti (PDF/Word)</small>
            </span>
          </label>
          <label className="field" style={{ maxWidth: 220, marginTop: 6 }}>
            <span>Gün sonu raporu saati</span>
            <select className="input" value={data.dailyHour} disabled={!data.daily} onChange={(e) => void save({ ...data, dailyHour: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          {permission === 'default' && (
            <button
              type="button"
              className="button"
              style={{ alignSelf: 'flex-start', marginTop: 10 }}
              onClick={() => void requestWebNotifications().then(() => setPermission(webNotificationState()))}
            >
              Tarayıcı bildirimlerine izin ver
            </button>
          )}
          {permission === 'denied' && (
            <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>
              Tarayıcı bildirimleri engellenmiş; adres çubuğundaki site ayarlarından izin verebilirsiniz.
            </p>
          )}
          {error && <div className="alert tone-risk">{error}</div>}
        </div>
      )}
    </Panel>
  )
}

/** Oturumu kapatır: şifre çözme anahtarı bellekten silinir, giriş ekranına dönülür */
function SessionPanel() {
  const { me, signOut } = useAuth()
  return (
    <Panel title="Oturum" subtitle={`Giriş yapılan hesap: ${me.email ?? ''}`}>
      <p className="faint" style={{ marginBottom: 12, fontSize: 13 }}>
        Çıkış yapınca verilerinizin anahtarı bellekten silinir; tekrar açmak için parolanız gerekir.
      </p>
      <button type="button" className="button" onClick={() => void signOut()}>
        <LogoutIcon size={16} /> Çıkış yap
      </button>
    </Panel>
  )
}

const THEMES: { mode: ThemeMode; label: string; text: string }[] = [
  { mode: 'dark', label: 'Koyu', text: 'Gece laciverdi; az ışıkta göz yormaz' },
  { mode: 'light', label: 'Açık', text: 'Sis mavisi; aydınlık ortamlar için' },
]

/** Görünüm: koyu / açık tema. Seçim bu tarayıcıda hatırlanır. */
function AppearancePanel() {
  const { mode, setMode } = useTheme()
  return (
    <Panel title="Görünüm" subtitle="Seçim bu tarayıcıda hatırlanır">
      <div className="provider-grid" role="radiogroup" aria-label="Tema">
        {THEMES.map((theme) => (
          <button
            key={theme.mode}
            type="button"
            role="radio"
            aria-checked={mode === theme.mode}
            className={`provider-card theme-card${mode === theme.mode ? ' selected' : ''}`}
            onClick={() => setMode(theme.mode)}
          >
            <span className={`theme-swatch theme-swatch-${theme.mode}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="provider-name">{theme.label}</span>
            <span className="provider-text">{theme.text}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

function ProfilePanel() {
  const { me, refresh } = useAuth()
  const [name, setName] = useState(me.name ?? '')
  const [country, setCountry] = useState(me.country ?? '')
  const statusInfo = useApi(getAuthStatus)
  const [status, setStatus] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await updateMe({ name, ...(country ? { country } : {}) })
      await refresh()
      setStatus('Kaydedildi.')
    } catch (err) {
      setStatus(toApiError(err).message)
    }
  }

  async function replayOnboarding() {
    await updateMe({ onboardingCompleted: false })
    await refresh()
  }

  return (
    <Panel title="Profil">
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>E-posta</span>
          <input className="input" value={me.email ?? ''} disabled />
        </label>
        <label className="field">
          <span>Ad</span>
          <input className="input" value={name} required minLength={2} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        {statusInfo.data && <CountryField countries={statusInfo.data.countries} value={country} onChange={setCountry} />}
        <span className="field-hint" style={{ marginTop: -6 }}>
          Ülke, gündemde hangi ülkenin haber kaynaklarının kullanılacağını belirler. Verilerin para birimi değişmez (Veri
          Yönetimi'nden değiştirilebilir).
        </span>
        <GoogleLink />
        {status && <div className="faint">{status}</div>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button type="button" className="button" onClick={() => void replayOnboarding()} style={{ marginRight: 'auto' }}>
            Kurulumu tekrar göster
          </button>
          <button type="submit" className="button button-primary">
            Kaydet
          </button>
        </div>
      </form>
    </Panel>
  )
}

/** Google hesabı bağlantısı: bağlıysa kaldırılabilir; değilse nasıl bağlanacağı anlatılır. */
function GoogleLink() {
  const { me, refresh } = useAuth()
  const status = useApi(getAuthStatus)
  const [error, setError] = useState<string | null>(null)
  if (!status.data?.googleEnabled && !me.googleLinked) return null

  async function unlink() {
    if (!window.confirm('Google bağlantısı kaldırılsın mı? Giriş için e-posta ve parolanızı kullanırsınız.')) return
    try {
      await unlinkGoogle()
      await refresh()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <div className="field">
      <span>Google ile giriş</span>
      {me.googleLinked ? (
        <div className="assign-form" style={{ marginTop: 0 }}>
          <span className="muted" style={{ flex: 1 }}>
            Bağlı — Google ile devam edip veri parolanızı girersiniz.
          </span>
          <button type="button" className="button button-small" onClick={() => void unlink()}>
            Bağlantıyı kaldır
          </button>
        </div>
      ) : (
        <span className="muted">
          Bağlı değil. Bağlamak için çıkış yapıp giriş ekranında "Google ile devam et"i seçin (aynı e-posta adresiyle) ve bu
          hesabın parolasını girin.
        </span>
      )}
      {error && <div className="alert tone-risk">{error}</div>}
    </div>
  )
}

function PasswordPanel() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'risk' | 'opportunity'; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setMessage({ tone: 'opportunity', text: 'Parola değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.' })
    } catch (err) {
      setMessage({ tone: 'risk', text: toApiError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Parola" subtitle="Veri anahtarınız yeni parolayla yeniden şifrelenir; verileriniz değişmez">
      <form className="stack" style={{ gap: 12 }} onSubmit={(e) => void submit(e)}>
        <PasswordField label="Mevcut parola" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="Yeni parola" value={next} onChange={setNext} autoComplete="new-password" minLength={MIN_PASSWORD} />
        {message && (
          <div className={`alert tone-${message.tone}`} role="alert" style={{ marginTop: 0 }}>
            {message.text}
          </div>
        )}
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button type="submit" className="button button-primary" disabled={busy || !current || !passwordRules(next, MIN_PASSWORD).every((r) => r.ok)}>
            {busy ? 'Değiştiriliyor…' : 'Parolayı değiştir'}
          </button>
        </div>
      </form>
    </Panel>
  )
}

function RecoveryPanel() {
  const [password, setPassword] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setKey((await createRecoveryKey(password)).recoveryKey)
      setPassword('')
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Kurtarma anahtarı" subtitle="Kaybettiyseniz yenisini oluşturun; eski anahtar geçersiz olur">
      {key ? (
        <RecoveryKeyPanel recoveryKey={key} onDone={() => setKey(null)} doneLabel="Tamam" />
      ) : (
        <form className="assign-form" onSubmit={(e) => void submit(e)}>
          <PasswordField label="Parolanız" value={password} onChange={setPassword} autoComplete="current-password" />
          <button type="submit" className="button" disabled={busy || !password}>
            {busy ? 'Oluşturuluyor…' : 'Yeni kurtarma anahtarı oluştur'}
          </button>
          {error && <div className="alert tone-risk" style={{ flexBasis: '100%' }}>{error}</div>}
        </form>
      )}
    </Panel>
  )
}

/** İşletme verilerini sıfırla (ör. denemek için girilmiş örnek verileri temizlemek) */
function ResetPanel() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ tone: 'risk' | 'opportunity'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!window.confirm('Tüm satış, ürün, müşteri, stok ve gider kayıtlarınız silinecek. Hesabınız ve ayarlarınız kalır. Emin misiniz?')) return
    setBusy(true)
    setMessage(null)
    try {
      await resetData(password)
      setPassword('')
      notifyDataChanged()
      setMessage({ tone: 'opportunity', text: 'Verileriniz silindi. Veri Yönetimi\'nden yeniden yükleyebilirsiniz.' })
    } catch (err) {
      setMessage({ tone: 'risk', text: toApiError(err).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Verilerimi sıfırla" subtitle="Satış, ürün, müşteri, stok, gider, bölge ve çalışan kayıtları silinir; hesabınız, profiliniz ve para biriminiz kalır">
      <form className="assign-form" onSubmit={(e) => void submit(e)}>
        <PasswordField label="Onay için parolanız" value={password} onChange={setPassword} autoComplete="current-password" />
        <button type="submit" className="button button-danger" disabled={busy || !password}>
          {busy ? 'Siliniyor…' : 'Tüm verilerimi sil'}
        </button>
        {message && (
          <div className={`alert tone-${message.tone}`} style={{ flexBasis: '100%' }}>
            {message.text}
          </div>
        )}
      </form>
    </Panel>
  )
}

function DeletePanel() {
  const { signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!window.confirm('Hesabınız ve TÜM verileriniz kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?')) return
    setError(null)
    try {
      await deleteAccount(password)
      await signOut()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <Panel title="Hesabı sil" subtitle="Hesabınız ve şifreli veri dosyanız bu bilgisayardan kalıcı olarak silinir">
      <form className="assign-form" onSubmit={(e) => void submit(e)}>
        <PasswordField label="Onay için parolanız" value={password} onChange={setPassword} autoComplete="current-password" />
        <button type="submit" className="button button-danger" disabled={!password}>
          Hesabı ve verileri sil
        </button>
        {error && <div className="alert tone-risk" style={{ flexBasis: '100%' }}>{error}</div>}
      </form>
    </Panel>
  )
}
