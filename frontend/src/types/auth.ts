/** Ülke ve o ülke için verilerin para birimi olarak önerilen para birimi */
export interface CountryOption {
  code: string
  /** Desteklenen (kurla çevrilebilen) para birimi */
  currency: string
  /** Ülkenin yerel para birimi; desteklenmiyorsa currency'den farklıdır */
  native: string
}

export interface AuthStatus {
  countries: CountryOption[]
  passwordMinLength: number
  /** Google ile giriş yapılandırılmış mı */
  googleEnabled: boolean
  /** Google girişi yalnızca bu adresten açıldığında çalışır (Google'a kayıtlı dönüş adresi) */
  googleAppUrl: string | null
  /** Telefondaki uygulama: hesaplar bu cihaza özel */
  device?: boolean
  /** Yalnızca cihazda: bu cihazda kayıtlı hesap var mı */
  hasAccounts?: boolean
}

/** Google kimliği doğrulandı; veri parolası bekleniyor */
export interface GooglePending {
  /** unlock: bağlı hesap · link: aynı e-postalı parolalı hesap · register: yeni hesap */
  kind: 'unlock' | 'link' | 'register'
  email: string
  name: string | null
}

/** Kayıt/giriş yanıtı. recoveryKey yalnızca kayıt anında bir kez döner. */
export interface AuthUser {
  email: string
  recoveryKey?: string
}

/** GET /api/me */
export interface Me {
  email: string | null
  name: string | null
  /** ISO ülke kodu, ör. 'TR' */
  country: string | null
  onboardingCompleted: boolean
  googleLinked: boolean
}
