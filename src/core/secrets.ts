/**
 * Secrets live in Windows Credential Manager (Rust `secrets` service), never in store.json.
 *
 * Prefer not to read them into the UI at all: put `secretRef("stripe.key")` in a URL, header or
 * body passed to `httpJson` and Rust substitutes the value.
 */
import { call } from "./backend";

export const secrets = {
  get: (key: string) => call<string | null>("secrets", "get", { key }),
  has: (key: string) => call<boolean>("secrets", "has", { key }),
  /** An empty value deletes the secret. */
  set: (key: string, value: string) => call<void>("secrets", "set", { key, value }),
  delete: (key: string) => call<void>("secrets", "delete", { key }),
};

/** Placeholder replaced by Rust's http service: `Authorization: \`Bearer ${secretRef("stripe.key")}\``. */
export function secretRef(key: string): string {
  return `{{secret:${key}}}`;
}

/** The secret key a widget's declarative connect field is stored under. */
export function widgetSecretKey(widgetId: string, field: string): string {
  return `${widgetId}.${field}`;
}
