import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

/** In onSubmit werfen, um den Dialog nach Erfolg offen zu lassen (z. B. für eine Bestätigung). */
export class KeepOpen extends Error {}

/**
 * Dialog mit Formular. Schließen über Esc, Abbrechen oder Klick neben den Dialog.
 * `onSubmit` darf einen Fehler werfen – die Meldung wird im Dialog angezeigt.
 */
export function FormModal({ title, submitLabel = 'Speichern', danger, onClose, onSubmit, children, wide }: {
  title: string;
  submitLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      if (!(err instanceof KeepOpen)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className={`card modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="btn ghost small" onClick={onClose} disabled={busy} aria-label="Schließen"><Icon name="x" size={15} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {error && <div className="login-error modal-error" role="alert">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="submit" className={`btn primary${danger ? ' danger' : ''}`} disabled={busy}>{busy ? 'Bitte warten …' : submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

/** Eingabefeld mit Beschriftung (nutzt die vorhandenen Klassen .field/.input). */
export function TextField({ label, value, onChange, type = 'text', required, placeholder, autoFocus, hint, autoComplete, disabled }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: ReactNode;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && ' *'}</label>
      <input id={id} className="input" type={type} value={value} required={required} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete={autoComplete} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, hint, disabled }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="hstack small" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
