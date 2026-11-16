/**
 * OAuth sign-in for widgets whose vendor requires it (Gmail, Search Console, X), on top of the
 * Rust `online.oauth_sign_in` / `online.oauth_refresh` commands: PKCE + loopback redirect, with
 * the user's own OAuth client. Tokens never reach the UI; requests use secret references.
 */
import { useEffect, useState, type ComponentType, type FormEvent } from "react";
import { ExternalLink, KeyRound, LogIn } from "lucide-react";
import { BackendError, call } from "../../../core/backend";
import { setConnected } from "../../../core/connections";
import { HttpError, httpJson, type HttpRequest } from "../../../core/http";
import { secretRef, secrets } from "../../../core/secrets";
import { getStored, setStored } from "../../../core/store";
import type { CardProps, ConnectField } from "../../../core/widget";
import { Button, CardFrame, ErrorState, Spinner, TextInput } from "../../../ui";
import { vendorDetail } from "../../finance/shared/account";
import { PlainError, resetPolled } from "../../finance/shared/poll";

export interface OAuthAccount {
  /** "online.gmail": secrets "<ns>.clientId", "<ns>.clientSecret", "<ns>.token.access|refresh". */
  ns: string;
  /** "Gmail" - used in messages ("No answer from the Gmail sign-in…"). */
  name: string;
  /** "Google" / "X" - the sign-in button and sign-out messages. */
  vendor: string;
  ids: string[];
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extra?: Record<string, string>;
  /** Fixed loopback port (X needs a registered redirect); 0 = any. */
  port?: number;
  path?: string;
  /** Client secret is optional (public PKCE clients); when given it is sent as Basic auth. */
  secretOptional?: boolean;
  basicAuthWithSecret?: boolean;
  guide: { steps: string[]; url: string; linkLabel: string };
  clientIdHelp?: string;
}

interface OAuthState {
  expiresAt: number;
  hasSecret?: boolean;
}

const stateKey = (a: OAuthAccount) => `${a.ns}.oauth`;
const tokenPrefix = (a: OAuthAccount) => `${a.ns}.token`;

function commandArgs(a: OAuthAccount, hasSecret: boolean) {
  return {
    tokenUrl: a.tokenUrl,
    clientIdKey: `${a.ns}.clientId`,
    clientSecretKey: hasSecret ? `${a.ns}.clientSecret` : undefined,
    tokenPrefix: tokenPrefix(a),
    basicAuth: Boolean(a.basicAuthWithSecret && hasSecret),
    name: a.name,
  };
}

/** Plain words for what the Rust side reports. */
export function signInMessage(a: Pick<OAuthAccount, "name" | "vendor" | "port">, e: unknown): string {
  if (e instanceof PlainError) return e.message;
  if (e instanceof BackendError) {
    const m = e.message;
    if (e.code === "timeout") return `No answer from the ${a.name} sign-in within 3 minutes, or its browser tab was closed. Press Sign in again to retry.`;
    if (m.startsWith("access_denied")) return "You cancelled the sign-in in the browser.";
    if (m.startsWith("bad_client")) return `${a.vendor} refused this client ID and secret. Paste both once more.`;
    if (m.startsWith("signed_out")) return `GlintBar was signed out by ${a.vendor} - please sign in again.`;
    if (e.code === "io" && m.includes("local port")) return `Another program is using local port ${a.port ?? ""}: quit that program, or retry in a minute.`.replace("port :", "port:");
    if (e.code === "missing_secret") return "Save your OAuth client before signing in.";
    if (e.code === "offline") return "GlintBar is offline or cannot reach the sign-in server.";
    if (e.code === "unknown_method" || e.code === "unsupported") return "Sign-in only works in the GlintBar desktop app, not in the browser preview.";
    return m.replace(/^[a-z_]+: /, "");
  }
  if (e instanceof Error) return e.message;
  return "The sign-in did not complete.";
}

export async function signIn(a: OAuthAccount): Promise<void> {
  const hasSecret = await secrets.has(`${a.ns}.clientSecret`);
  const info = await call<{ expiresAt: number }>("online", "oauth_sign_in", {
    ...commandArgs(a, hasSecret),
    authUrl: a.authUrl,
    scopes: a.scopes,
    port: a.port ?? 0,
    path: a.path ?? "/",
    extra: a.extra ?? {},
    timeoutSecs: 180,
  });
  setStored<OAuthState>(stateKey(a), { expiresAt: info.expiresAt, hasSecret });
  resetPolled(a.ns);
  for (const id of a.ids) setConnected(id, true);
}

/** Signs out: forgets the tokens (keeps the OAuth client so signing in again is one click). */
export async function signOut(a: OAuthAccount, forgetClient = false): Promise<void> {
  // Clear the state first so a refresh racing with this cannot bring the sign-in back.
  setStored(stateKey(a), null);
  for (const id of a.ids) setConnected(id, false);
  resetPolled(a.ns);
  await secrets.delete(`${tokenPrefix(a)}.access`).catch(() => {});
  await secrets.delete(`${tokenPrefix(a)}.refresh`).catch(() => {});
  if (forgetClient) {
    await secrets.delete(`${a.ns}.clientId`).catch(() => {});
    await secrets.delete(`${a.ns}.clientSecret`).catch(() => {});
  }
}

const refreshing = new Map<string, Promise<void>>();

async function refresh(a: OAuthAccount): Promise<void> {
  let p = refreshing.get(a.ns);
  if (!p) {
    p = (async () => {
      const st = getStored<OAuthState | null>(stateKey(a), null);
      if (!st) throw new PlainError(`${a.name} is not signed in yet. Use the Sign in button on its card.`);
      try {
        const info = await call<{ expiresAt: number }>("online", "oauth_refresh", commandArgs(a, Boolean(st.hasSecret)));
        // Signed out meanwhile? Then don't resurrect the state.
        if (getStored<OAuthState | null>(stateKey(a), null)) setStored<OAuthState>(stateKey(a), { ...st, expiresAt: info.expiresAt });
      } catch (e) {
        if (e instanceof BackendError && (e.code === "denied" || e.code === "missing_secret")) throw new PlainError(`GlintBar was signed out by ${a.vendor} - please sign in again.`);
        throw e;
      }
    })().finally(() => refreshing.delete(a.ns));
    refreshing.set(a.ns, p);
  }
  return p;
}

/** JSON from an OAuth-protected API; refreshes the token when needed and once on a 401. */
export async function oauthJson<T>(a: OAuthAccount, url: string, req: HttpRequest = {}, map403?: (detail: string) => string | undefined): Promise<T> {
  const st = getStored<OAuthState | null>(stateKey(a), null);
  if (!st) throw new PlainError(`${a.name} is not signed in yet. Use the Sign in button on its card.`);
  if (st.expiresAt && Date.now() > st.expiresAt - 60_000) await refresh(a);
  const go = () => httpJson<T>(url, { ...req, headers: { ...(req.headers ?? {}), Authorization: `Bearer ${secretRef(`${tokenPrefix(a)}.access`)}` } });
  try {
    return await go();
  } catch (e) {
    if (e instanceof HttpError && e.kind === "unauthorized") {
      await refresh(a);
      return await go();
    }
    if (e instanceof HttpError && e.kind === "forbidden") {
      const detail = vendorDetail(e.detail);
      throw new PlainError(map403?.(detail) ?? (detail ? `${a.vendor}: ${detail}` : `GlintBar has no permission to read this from ${a.name}.`));
    }
    throw e;
  }
}

/** The Connect card: paste your OAuth client once, then "Sign in with <vendor>". */
export function makeOAuthConnect(a: OAuthAccount): ComponentType<CardProps> {
  return function OAuthConnect({ close }: CardProps) {
    const [hasClient, setHasClient] = useState<boolean | null>(null);
    const [editing, setEditing] = useState(false);
    const [id, setId] = useState("");
    const [secret, setSecret] = useState("");
    const [busy, setBusy] = useState<"save" | "signin" | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      secrets
        .has(`${a.ns}.clientId`)
        .then(setHasClient)
        .catch(() => setHasClient(false));
    }, []);

    const save = async (e: FormEvent) => {
      e.preventDefault();
      if (!id.trim()) return setError("Client ID is empty.");
      if (!a.secretOptional && !secret.trim()) return setError("Client secret is empty.");
      setBusy("save");
      setError(null);
      try {
        await secrets.set(`${a.ns}.clientId`, id.trim());
        await secrets.set(`${a.ns}.clientSecret`, secret.trim());
        setHasClient(true);
        setEditing(false);
        setId("");
        setSecret("");
      } catch (err) {
        setError(signInMessage(a, err));
      } finally {
        setBusy(null);
      }
    };

    const start = async () => {
      setBusy("signin");
      setError(null);
      try {
        await signIn(a);
        close();
      } catch (err) {
        setError(signInMessage(a, err));
      } finally {
        setBusy(null);
      }
    };

    const showForm = hasClient === false || editing;
    const fields: ConnectField[] = [
      { key: "clientId", label: "Client ID", help: a.clientIdHelp },
      { key: "clientSecret", label: "Client secret", optional: a.secretOptional },
    ];
    return (
      <CardFrame title={`Connect ${a.name}`} subtitle="Sample figures until you sign in" icon={KeyRound}>
        {showForm ? (
          <form onSubmit={save} className="flex flex-col gap-3">
            <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-snug text-dim">
              {a.guide.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[12px] text-fg">
                  {f.label}
                  {f.optional && <span className="text-faint"> (optional)</span>}
                </span>
                <TextInput
                  type={f.key === "clientSecret" ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  value={f.key === "clientId" ? id : secret}
                  onChange={(e) => (f.key === "clientId" ? setId(e.target.value) : setSecret(e.target.value))}
                />
                {f.help && <span className="text-[11px] text-faint">{f.help}</span>}
              </label>
            ))}
            {error && <ErrorState message={error} />}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => call("shell", "open", { target: a.guide.url }).catch(() => {})}>
                {a.guide.linkLabel}
              </Button>
              <Button variant="primary" type="submit" disabled={busy !== null}>
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] leading-snug text-dim">
              GlintBar has your OAuth client. The button opens a browser tab where you sign in. If {a.vendor} warns that the app isn't verified, that app is the one you made: pick Advanced and continue to it.
            </p>
            {error && <ErrorState message={error} />}
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Change client
              </Button>
              <Button variant="primary" icon={busy === "signin" ? undefined : LogIn} onClick={start} disabled={busy !== null || hasClient === null}>
                {busy === "signin" ? (
                  <>
                    <Spinner size={12} /> Waiting for the browser…
                  </>
                ) : (
                  `Sign in with ${a.vendor}`
                )}
              </Button>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-snug text-faint">GlintBar requests read-only access, and your tokens are kept in Windows Credential Manager on this PC.</p>
      </CardFrame>
    );
  };
}

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The Google Cloud steps both Gmail and Search Console need. */
export function googleGuide(api: string, appName: string): string[] {
  return [
    "In the Google Cloud console, pick a project or make a new one.",
    `Search APIs & Services → Library for ${api} and press Enable.`,
    `Under Google Auth Platform → Branding, give the app a name such as ${appName} and add your email. If asked for a user type, pick External.`,
    "On the Audience page, leave Publishing status at Testing and add your own Gmail address to Test users.",
    "Open Clients, press Create client and pick Desktop app as the type. Copy its Client secret and Client ID.",
  ];
}
