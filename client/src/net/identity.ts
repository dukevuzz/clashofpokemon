/** Who you are, according to the meta tier. */

const ACCOUNT_KEY = "clashofpokemon.account";
const REFRESH_KEY = "clashofpokemon.refresh";

export interface Account {
  id: string;
  displayName: string;
  guest: boolean;
}

/** Where the meta tier lives. Same host in production, a port away in dev. */
export function apiBase(): string {
  const env = (import.meta as { env?: Record<string, string> }).env;
  if (env?.VITE_API) return env.VITE_API;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4500`;
}

const read = <T>(key: string): T | undefined => {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

export const savedAccount = () => read<Account>(ACCOUNT_KEY);

/** In memory only. A page reload spends the refresh token again. */
let access: string | undefined;

async function post<T>(path: string, body?: unknown, bearer?: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Be somebody. */
export async function signIn(): Promise<Account> {
  const refresh = read<string>(REFRESH_KEY);
  if (refresh) {
    try {
      await spend(refresh);
      const account = savedAccount();
      if (account) return account;
    } catch {
      // The stored token is dead: expired, revoked, or the account is gone.
      // Becoming a new guest beats refusing to play.
    }
  }

  const created = await post<{ account: Account; refresh: string }>("/v1/auth/guest");
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(created.account));
  localStorage.setItem(REFRESH_KEY, JSON.stringify(created.refresh));
  await spend(created.refresh);
  return created.account;
}

/** Trade the refresh token for a session, and store the replacement. */
async function spend(refresh: string): Promise<void> {
  const session = await post<{ access: string; refresh: string }>(
    "/v1/auth/refresh", { refresh });
  access = session.access;
  // Rotated: the old one is dead the moment this succeeds, so it must be
  // replaced before anything else can go wrong.
  localStorage.setItem(REFRESH_KEY, JSON.stringify(session.refresh));
}

/** A ticket for the game socket. */
export async function ticket(): Promise<string> {
  try {
    return (await post<{ ticket: string }>("/v1/auth/ticket", undefined, access)).ticket;
  } catch {
    const refresh = read<string>(REFRESH_KEY);
    if (!refresh) throw new Error("not signed in");
    await spend(refresh);
    return (await post<{ ticket: string }>("/v1/auth/ticket", undefined, access)).ticket;
  }
}

/**
 * A request that carries the session, renewing it once if it has expired.
 *
 * An access token lasts fifteen minutes and the menu is a screen people leave
 * open, so the *first* call after a while is very often the one that fails.
 * Retrying it silently is the difference between "send" working and "send"
 * telling somebody to reload before they can report a bug.
 *
 * Unlike `post`, this hands back the Response rather than parsed JSON: a
 * refusal here is meaningful -- 429 and its Retry-After header, a validation
 * message meant for the player -- and throwing on it would discard exactly the
 * part the caller needs.
 */
export async function authorized(url: string, init: RequestInit = {}): Promise<Response> {
  const withToken = () =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, ...(access ? { authorization: `Bearer ${access}` } : {}) },
    });

  let res = await withToken();
  if (res.status !== 401) return res;

  const refresh = read<string>(REFRESH_KEY);
  if (!refresh) throw new Error("not signed in");
  await spend(refresh);
  res = await withToken();
  return res;
}

/** Is the meta tier reachable? Asked, not assumed -- it may simply not exist. */
export async function apiReachable(timeoutMs = 1500): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase()}/v1/content`, { signal: abort.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
