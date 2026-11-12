/** Uygulama açılırken: animasyonlu logo, ad ve ince bir yükleme çubuğu. */
export function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="Clario açılıyor">
      <div className="splash-logo">
        <span className="splash-ring" aria-hidden="true" />
        <img src="/icon-192.png" alt="" width={96} height={96} />
      </div>
      <div className="splash-name">Clario</div>
      <div className="splash-tagline">Veriden karara</div>
      <div className="splash-bar" aria-hidden="true">
        <span />
      </div>
    </div>
  )
}
