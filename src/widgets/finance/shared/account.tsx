/**
 * One connection shared by several widgets (e.g. "Stripe" and "Stripe Chart"): the user pastes
 * the key once, every widget in `ids` flips to live data, and Disconnect clears them all.
 *
 * Secret fields are stored as "<ns>.<field>" in Credential Manager; other fields go to the
 * store key "<ns>.settings" (never into one tile's config, so the sibling tile sees them too).
 */
import { useCallback, useMemo, type ComponentType } from "react";
import { setConnected } from "../../../core/connections";
import { HttpError } from "../../../core/http";
import { secretRef, secrets } from "../../../core/secrets";
import { getStored, setStored, useStored } from "../../../core/store";
import type { CardProps, ConnectSpec, WidgetDef } from "../../../core/widget";
import { ConnectForm } from "../../../ui";
import { PlainError, resetPolled } from "./poll";

export interface Account {
  /** Secret namespace and poll-key prefix, e.g. "finance.stripe". Starts with the domain. */
  ns: string;
  /** Shown to the user: "Stripe". */
  name: string;
  /** Widget ids that share this connection. */
  ids: string[];
  spec: ConnectSpec;
  /** More secrets written later (tokens) that Disconnect must delete, as field names. */
  extraSecrets?: string[];
}

/** How a provider reads its credentials: live (secret references) or while testing a new key. */
export interface Ctx {
  /** A value to put in a header/URL/body: a secret reference, or the raw value during the connect test. */
  secret: (field: string) => string;
  settings: Record<string, string>;
  /** True during the connect test (values are raw and not saved yet). */
  testing: boolean;
}

export function settingsKey(acc: Pick<Account, "ns">): string {
  return `${acc.ns}.settings`;
}

export function getSettings(acc: Pick<Account, "ns">): Record<string, string> {
  return getStored<Record<string, string>>(settingsKey(acc), {});
}

export function setSetting(acc: Pick<Account, "ns">, key: string, value: string | undefined): void {
  const cur = { ...getSettings(acc) };
  if (value === undefined) delete cur[key];
  else cur[key] = value;
  setStored(settingsKey(acc), cur);
}

export function useSettingsOf(acc: Pick<Account, "ns">): Record<string, string> {
  const [s] = useStored<Record<string, string>>(settingsKey(acc), {});
  return s;
}

export function liveCtx(acc: Pick<Account, "ns">): Ctx {
  return { secret: (f) => secretRef(`${acc.ns}.${f}`), settings: getSettings(acc), testing: false };
}

export function testCtx(values: Record<string, string>): Ctx {
  return { secret: (f) => values[f] ?? "", settings: values, testing: true };
}

export async function disconnectAccount(acc: Account): Promise<void> {
  const fields = [...acc.spec.fields.filter((f) => f.secret).map((f) => f.key), ...(acc.extraSecrets ?? [])];
  for (const f of fields) await secrets.delete(`${acc.ns}.${f}`).catch(() => {});
  setStored(settingsKey(acc), null);
  resetPolled(acc.ns);
  for (const id of acc.ids) setConnected(id, false);
}

/** The `Connect` component for every widget of the account. */
export function makeConnect(acc: Account): ComponentType<CardProps> {
  const pseudo = { id: acc.ns, name: acc.name, category: "Finance", description: acc.name, size: "m", Tile: () => null, connect: acc.spec } as unknown as WidgetDef;
  return function AccountConnect(_: CardProps) {
    const [settings, setSettings] = useStored<Record<string, string>>(settingsKey(acc), {});
    const setConfig = useCallback((patch: Record<string, unknown>) => {
      setSettings((s) => ({ ...s, ...(patch as Record<string, string>) }));
    }, [setSettings]);
    const config = useMemo(() => ({ ...settings }), [settings]);
    return (
      <ConnectForm
        widget={pseudo}
        config={config}
        setConfig={setConfig}
        onConnected={() => {
          resetPolled(acc.ns);
          for (const id of acc.ids) setConnected(id, true);
        }}
      />
    );
  };
}

/**
 * Maps HTTP failures to the vendor's name and plain words:
 * e.g. "The key was rejected by Stripe" or "... reading this data is not allowed".
 */
export async function guard<T>(name: string, fn: () => Promise<T>, msgs: { unauthorized?: string; forbidden?: string; notFound?: string } = {}): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) {
      const detail = vendorDetail(e.detail);
      if (e.kind === "unauthorized") throw new PlainError(msgs.unauthorized ?? `The key was rejected by ${name}. Paste it again, or make a new key.`);
      if (e.kind === "forbidden") throw new PlainError(msgs.forbidden ?? `This key works with ${name}, but reading this data is not allowed.${detail ? " " + detail : ""}`);
      if (e.kind === "not_found") throw new PlainError(msgs.notFound ?? `${name} has nothing under that account or ID. Make sure both are right.`);
    }
    throw e;
  }
}

/** Pulls a short human message out of a vendor's JSON error body. */
export function vendorDetail(body: string | undefined): string {
  if (!body) return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = JSON.parse(body);
    const m = j?.error?.message ?? j?.error?.detail ?? j?.message ?? j?.detail ?? j?.errors?.[0]?.message ?? j?.errors?.[0]?.detail ?? j?.error_description ?? (typeof j?.error === "string" ? j.error : "");
    return typeof m === "string" ? m.slice(0, 220) : "";
  } catch {
    return "";
  }
}
