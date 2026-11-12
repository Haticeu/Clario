import { useState } from 'react'
import { saveBlob } from '../../utils/download'

/**
 * Kurtarma anahtarı yalnızca bir kez gösterilir. Parola unutulursa veriye erişmenin tek yolu budur;
 * kullanıcı kaydettiğini onaylamadan devam edemez.
 */
export function RecoveryKeyPanel({ recoveryKey, onDone, doneLabel = 'Devam et' }: { recoveryKey: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey)
      setCopied(true)
    } catch {
      window.prompt('Kurtarma anahtarını kopyalayın:', recoveryKey)
    }
  }

  function download() {
    const text =
      'Clario kurtarma anahtarı\n\n' +
      `${recoveryKey}\n\n` +
      'Parolanızı unutursanız verilerinize yalnızca bu anahtarla ulaşabilirsiniz.\n' +
      'Güvenli bir yerde saklayın ve kimseyle paylaşmayın.\n'
    void saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'clario-kurtarma-anahtari.txt')
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="alert tone-warning" style={{ marginTop: 0 }}>
        Verileriniz parolanızla şifrelenir; Clario dahil kimse parolanızı sıfırlayamaz. Parolanızı unutursanız verilerinize
        <b> yalnızca bu kurtarma anahtarıyla</b> ulaşabilirsiniz. Anahtar bir daha gösterilmeyecek.
      </div>
      <code className="recovery-key" aria-label="Kurtarma anahtarı">
        {recoveryKey}
      </code>
      <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
        <button type="button" className="button" onClick={() => void copy()}>
          {copied ? 'Kopyalandı ✓' : 'Kopyala'}
        </button>
        <button type="button" className="button" onClick={download}>
          Dosya olarak indir
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Kurtarma anahtarını güvenli bir yere kaydettim</span>
      </label>
      <button type="button" className="button button-primary button-block" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  )
}
