/** Hash routes ("#/letter/001001"), so the app works from any folder or subpath. */

import { useEffect, useState } from 'react';

export const ROUTES = [
  { id: 'import', label: '取り込み' },
  { id: 'diagnosis', label: '診断' },
  { id: 'scenario', label: 'シナリオ' },
  { id: 'proposal', label: '提案' },
  { id: 'letter', label: '申入書' },
  { id: 'negotiation', label: '交渉' },
  { id: 'export', label: '書き出し' },
  { id: 'followup', label: '反映チェック' },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

export interface Route {
  id: RouteId;
  arg: string | null;
}

const IDS = new Set<string>(ROUTES.map((r) => r.id));

export function parseHash(hash: string): Route | null {
  const m = /^#\/([a-z]+)(?:\/([^/?#]+))?/.exec(hash);
  if (!m || !IDS.has(m[1] ?? '')) return null;
  return { id: m[1] as RouteId, arg: m[2] ? decodeURIComponent(m[2]) : null };
}

export function href(id: RouteId, arg?: string | null): string {
  return `#/${id}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
}

export function navigate(id: RouteId, arg?: string | null): void {
  window.location.hash = href(id, arg);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash) ?? { id: 'import', arg: null });
  useEffect(() => {
    const on = () => {
      const r = parseHash(window.location.hash);
      if (r) setRoute(r);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
