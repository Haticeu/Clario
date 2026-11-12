import { useState, type FormEvent, type ReactNode } from 'react'
import { createResource, deleteResource, listResource, toApiError, updateResource } from '../../api'
import { useApi } from '../../hooks/useApi'
import type { ResourceName, ResourceRecords } from '../../types'
import { notifyDataChanged } from '../../utils/dataEvents'
import { AsyncContent, EmptyState } from '../states'
import { Panel } from '../ui'

export interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  required?: boolean
  placeholder?: string
  options?: { value: string | number; label: string }[]
  wide?: boolean
  /** Metin alanında, bu alana daha önce girilmiş değerleri öneri olarak sun (ör. departman adları) */
  suggest?: boolean
}

export interface ColumnConfig<R> {
  label: string
  render: (record: R) => ReactNode
  align?: 'right'
}

interface ResourceManagerProps<N extends ResourceName> {
  resource: N
  title: string
  description: ReactNode
  /** Tekil ad: "ürün", "müşteri"… (düğme ve onay metinlerinde) */
  noun: string
  columns: ColumnConfig<ResourceRecords[N]>[]
  fields: FieldConfig[]
  /** Kaydı düzenleme formuna doldurur */
  toForm: (record: ResourceRecords[N]) => Record<string, string>
  /** Silme onayında ve aramada kullanılan ad */
  label: (record: ResourceRecords[N]) => string
  /** Liste değişince (ör. yeni bölge eklendi) üst bileşene haber verir */
  onChanged?: () => void
  /** Form açılmadan önce gerekli bir ön koşul eksikse gösterilecek uyarı */
  blocker?: ReactNode
}

type FormState = { mode: 'create' } | { mode: 'edit'; id: number }

/** Bir kayıt türü için liste + arama + ekle/düzenle formu + silme. */
export function ResourceManager<N extends ResourceName>(props: ResourceManagerProps<N>) {
  const { resource, noun, fields } = props
  const list = useApi((signal) => listResource(resource, signal))
  const [form, setForm] = useState<FormState | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')

  function open(state: FormState, initial: Record<string, string>) {
    setForm(state)
    setValues(initial)
    setError(null)
  }

  function changed() {
    list.reload()
    props.onChanged?.()
    notifyDataChanged()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() === '' ? null : v]))
    try {
      if (form.mode === 'create') await createResource(resource, body)
      else await updateResource(resource, form.id, body)
      setForm(null)
      changed()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(record: ResourceRecords[N]) {
    if (!window.confirm(`"${props.label(record)}" silinsin mi? Bu işlem geri alınamaz.`)) return
    try {
      await deleteResource(resource, (record as { id: number }).id)
      changed()
    } catch (err) {
      window.alert(toApiError(err).message)
    }
  }

  const emptyForm = Object.fromEntries(fields.map((f) => [f.key, '']))

  /** Önceki kayıtlarda bu alana girilmiş farklı değerler (yazım birliği için öneri listesi) */
  const suggestions = (key: string) =>
    [...new Set((list.data ?? []).map((r) => (r as unknown as Record<string, unknown>)[key]).filter((v): v is string => typeof v === 'string' && v !== ''))].sort(
      (a, b) => a.localeCompare(b, 'tr-TR'),
    )

  return (
    <div className="stack">
      {form && (
        <Panel title={form.mode === 'create' ? `Yeni ${noun}` : `${noun[0]!.toLocaleUpperCase('tr-TR')}${noun.slice(1)} düzenle`}>
          <form onSubmit={submit}>
            <div className="form-grid">
              {fields.map((field) => (
                <label key={field.key} className={`field${field.wide ? ' field-wide' : ''}`}>
                  <span>
                    {field.label}
                    {field.required && ' *'}
                  </span>
                  {field.type === 'select' ? (
                    <select
                      className="input"
                      value={values[field.key] ?? ''}
                      required={field.required}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    >
                      <option value="">{field.required ? 'Seçin…' : '— Yok —'}</option>
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        className="input"
                        type={field.type === 'date' ? 'date' : 'text'}
                        inputMode={field.type === 'number' ? 'decimal' : undefined}
                        placeholder={field.placeholder}
                        required={field.required}
                        list={field.suggest ? `${resource}-${field.key}-options` : undefined}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                      {field.suggest && (
                        <datalist id={`${resource}-${field.key}-options`}>
                          {suggestions(field.key).map((value) => (
                            <option key={value} value={value} />
                          ))}
                        </datalist>
                      )}
                    </>
                  )}
                </label>
              ))}
            </div>
            {error && (
              <div className="alert tone-risk" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <button type="button" className="button" onClick={() => setForm(null)} disabled={saving}>
                Vazgeç
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title={props.title} subtitle={props.description}>
        <div className="toolbar">
          <input
            className="input input-search"
            type="search"
            placeholder="Ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`${props.title} içinde ara`}
          />
          <button
            type="button"
            className="button button-primary"
            onClick={() => open({ mode: 'create' }, emptyForm)}
            disabled={Boolean(props.blocker)}
          >
            + Yeni {noun}
          </button>
        </div>
        {props.blocker}

        <AsyncContent state={list}>
          {(records) => {
            const needle = query.toLocaleLowerCase('tr-TR').trim()
            const visible = needle
              ? records.filter((r) => props.label(r).toLocaleLowerCase('tr-TR').includes(needle))
              : records
            if (records.length === 0) {
              return <EmptyState title={`Henüz ${noun} yok`} description={`"+ Yeni ${noun}" ile ekleyin ya da Excel ile toplu yükleyin.`} />
            }
            if (visible.length === 0) return <EmptyState title="Aramayla eşleşen kayıt yok" />
            return (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {props.columns.map((c) => (
                        <th key={c.label} className={c.align === 'right' ? 'num' : undefined}>
                          {c.label}
                        </th>
                      ))}
                      <th className="num">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((record) => {
                      const id = (record as { id: number }).id
                      return (
                        <tr key={id}>
                          {props.columns.map((c) => (
                            <td key={c.label} className={c.align === 'right' ? 'num' : undefined}>
                              {c.render(record)}
                            </td>
                          ))}
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="button button-small"
                                onClick={() => open({ mode: 'edit', id }, props.toForm(record))}
                              >
                                Düzenle
                              </button>
                              <button type="button" className="button button-small button-danger" onClick={() => void remove(record)}>
                                Sil
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }}
        </AsyncContent>
      </Panel>
    </div>
  )
}
