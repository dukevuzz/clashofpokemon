/** Who you are, according to the meta tier. */

const ACCOUNT_KEY = "clashofpokemon.account";
const REFRESH_KEY = "clashofpokemon.refresh";

export interface Account {
  id: string;
  displayName: string;
  guest: boolean;
  /** The creature they wear. Absent until they pick one. */
  avatar?: string;
  /** How they log in. Absent for a guest, whose only proof is a token. */
  username?: string;
  /*
   * The record the server holds, which counts every match including the
   * offline ones. Optional because an older stored account predates them.
   */
  wins?: number;
  losses?: number;
  draws?: number;
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

  /*
   * Nothing signed in yet: become a guest and carry on.
   *
   * `signIn` is called lazily -- by feedback, by match-join, by play
   * reporting -- so a player who opened the menu and went straight to their
   * profile had no account at all. Creating one answered "not signed in",
   * which is an error about a precondition the player has no way to satisfy,
   * on the one screen whose whole purpose is to give them an account.
   *
   * Becoming a guest here is not a workaround. It is what the design says
   * happens: a guest and a registered player are the same row, and
   * registering fills credentials in on a row that already exists. This just
   * makes sure the row exists at the moment somebody asks for one.
   */
  const refresh = read<string>(REFRESH_KEY);
  if (!refresh) {
    await signIn();
  } else {
    await spend(refresh);
  }
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

/**
 * Change the name, the face, or both.
 *
 * Only the fields given are sent. A rename and a change of face happen on
 * different screens, and sending both every time means whichever saved last
 * silently overwrites the other.
 *
 * The reply is the account as the server now has it, and it is stored: without
 * that the menu keeps drawing the old name until something else reloads.
 */
export async function saveProfile(
  edit: { displayName?: string; avatar?: string },
): Promise<Account> {
  const res = await authorized(`${apiBase()}/v1/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(edit),
  });
  if (!res.ok) {
    // The server says why -- too long, empty, a character it will not take --
    // and the form prints it under the box. A generic failure here would
    // throw that away.
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error ?? `could not save: ${res.status}`);
  }
  const account = (await res.json()) as Account;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

/** Read a refusal the way the server meant it, or fall back to the status. */
async function reason(res: Response, fallback: string): Promise<string> {
  const said = (await res.json().catch(() => ({}))) as { error?: string };
  return said.error ?? `${fallback}: ${res.status}`;
}

/**
 * Put a username and a password on the account already being played.
 *
 * Authenticated, and there is no form of it that names an account: it can only
 * ever register the caller's own. The refresh token is untouched, because
 * signing up must not log somebody out of the account they are signing up --
 * the server binds credentials to the row rather than making a new one.
 */
export async function register(username: string, password: string): Promise<Account> {
  const res = await authorized(`${apiBase()}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    // Passed through rather than flattened. "That username is taken" and
    // "your password is too short" are different things for a form to say,
    // and only the server knows which one this is.
    throw new Error(await reason(res, "could not create the account"));
  }
  const account = (await res.json()) as Account;
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

/**
 * Come back to an account on a device that has never seen it.
 *
 * The one call here that hands a session to somebody who cannot already prove
 * who they are, so it is the one that must not leak whether a username exists:
 * a wrong name and a wrong password both come back as the same refusal.
 *
 * Whoever was signed in on this device is replaced. A guest with no history is
 * no loss; one with a record is, and the screen asks before calling this.
 */
export async function logIn(username: string, password: string): Promise<Account> {
  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("wrong username or password");

  const body = (await res.json()) as { account: Account; refresh: string };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(body.account));
  localStorage.setItem(REFRESH_KEY, JSON.stringify(body.refresh));
  // Spent immediately: without this the next request has no access token, and
  // `signIn` would quietly mint a new guest over the account just recovered.
  await spend(body.refresh);
  return body.account;
}

/**
 * Forget this device's account.
 *
 * Local only, deliberately. Revoking the refresh token server-side is the
 * right thing for a shared computer and the wrong thing for the common case
 * here -- a guest signing out has no way back in, so the token is the account.
 */
export function signOut() {
  access = undefined;
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem(REFRESH_KEY);
}
