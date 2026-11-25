/**
 * Schlanker Hash-Router (#/devices/dev-1?tab=sensors).
 *
 * Bewusst ohne externe Abhängigkeit: Hash-Routing funktioniert hinter jedem
 * statischen Webserver und Reverse-Proxy ohne zusätzliche Rewrite-Regeln –
 * das erleichtert die spätere Installation in beliebigen Umgebungen.
 */
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export interface Location {
  path: string;
  query: URLSearchParams;
}

function readLocation(): Location {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  try {
    if (options.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    // Manche eingebetteten Umgebungen (z. B. sandboxed iframes) erlauben die
    // History-API nicht – dann direkt über den Hash navigieren.
    window.location.hash = target;
  }
}

/** Setzt einzelne Query-Parameter, ohne einen neuen History-Eintrag zu erzeugen. */
export function updateQuery(patch: Record<string, string | null | undefined>) {
  const loc = readLocation();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') loc.query.delete(k);
    else loc.query.set(k, v);
  }
  const qs = loc.query.toString();
  navigate(`${loc.path}${qs ? `?${qs}` : ''}`, { replace: true });
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    const onChange = () => setLoc(readLocation());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return loc;
}

/** Vergleicht einen Pfad mit einem Muster wie "/devices/:id". */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

export interface RouteDef {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}

export function resolveRoute(routes: RouteDef[], path: string): ReactNode | null {
  for (const r of routes) {
    const params = matchPath(r.pattern, path);
    if (params) return r.render(params);
  }
  return null;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={`#${to}`} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
