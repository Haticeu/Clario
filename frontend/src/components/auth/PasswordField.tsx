import { useId, useState } from 'react'
import { passwordRules } from '../../auth'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  /** Verilirse parola kuralları canlı olarak gösterilir */
  minLength?: number
}

/** Göster/gizle düğmeli parola alanı; yeni parola için kuralları anlık gösterir. */
export function PasswordField({ label, value, onChange, autoComplete, minLength }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const hintId = useId()
  const rules = minLength ? passwordRules(value, minLength) : []

  return (
    <label className="field">
      <span>{label}</span>
      <div className="password-input">
        <input
          className="input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={rules.length ? hintId : undefined}
        />
        <button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}>
          {visible ? 'Gizle' : 'Göster'}
        </button>
      </div>
      {rules.length > 0 && (
        <ul className="password-rules" id={hintId}>
          {rules.map((rule) => (
            <li key={rule.label} className={rule.ok ? 'ok' : undefined}>
              {rule.ok ? '✓' : '○'} {rule.label}
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}
