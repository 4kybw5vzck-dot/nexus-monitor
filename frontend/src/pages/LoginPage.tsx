import { useState, type FormEvent } from 'react';
import { httpDataSource } from '../api';
import { appConfig } from '../app/config';
import { CompanyLogo } from '../components/ui/Logo';

/** Anmeldung am Backend (nur im HTTP-Modus). */
export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!httpDataSource) return;
    setBusy(true);
    setError(undefined);
    try {
      await httpDataSource.login(login.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand login-brand">
          <CompanyLogo height={34} />
        </div>
        <div className="card-body login-body">
          <div className="login-product">NEXUS Monitor</div>
          <h1 id="login-title" className="login-title">Anmelden</h1>
          <div className="muted small">{appConfig.instanceName}</div>
          <div className="field">
            <label htmlFor="login-user">Benutzername</label>
            <input id="login-user" className="input" autoComplete="username" autoFocus required value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="login-pass">Passwort</label>
            <input id="login-pass" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="btn primary login-submit" type="submit" disabled={busy || !login || !password}>
            {busy ? 'Anmeldung …' : 'Anmelden'}
          </button>
        </div>
      </form>
    </div>
  );
}
