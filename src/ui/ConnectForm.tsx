import { useState, type FormEvent } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { call } from "../core/backend";
import { setConnected } from "../core/connections";
import { describeError, HttpError } from "../core/http";
import { secrets, widgetSecretKey } from "../core/secrets";
import type { WidgetConfig, WidgetDef } from "../core/widget";
import { CardFrame } from "./CardFrame";
import { Button, TextInput } from "./controls";
import { ErrorState } from "./States";

/**
 * Renders a widget's declarative `connect` spec: guide steps, fields, Save.
 * Secret fields go to Credential Manager as "<widgetId>.<field>", others into the instance config.
 */
export function ConnectForm<C extends WidgetConfig>({
  widget,
  config,
  setConfig,
  onConnected,
}: {
  widget: WidgetDef<C>;
  config: C;
  setConfig: (patch: Partial<C>) => void;
  onConnected?: () => void;
}) {
  const spec = widget.connect;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec?.fields ?? []).map((f) => [f.key, f.secret ? "" : String(config[f.key] ?? "")])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!spec) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
    const missing = spec.fields.find((f) => !f.optional && !trimmed[f.key]);
    if (missing) {
      setError(`${missing.label} can't be empty.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (spec.test) await spec.test(trimmed);
      const patch: Record<string, unknown> = {};
      for (const f of spec.fields) {
        if (f.secret) await secrets.set(widgetSecretKey(widget.id, f.key), trimmed[f.key] ?? "");
        else patch[f.key] = trimmed[f.key] ?? "";
      }
      if (Object.keys(patch).length) setConfig(patch as Partial<C>);
      setConnected(widget.id, true);
      onConnected?.();
    } catch (err) {
      setError(err instanceof HttpError || !(err instanceof Error) ? describeError(err) : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardFrame title={`Connect ${widget.name}`} subtitle="Sample numbers are shown until you connect" icon={KeyRound}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {spec.guide && (
          <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-snug text-dim">
            {spec.guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {spec.fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[12px] text-fg">
              {f.label}
              {f.optional && <span className="text-faint"> (optional)</span>}
            </span>
            <TextInput
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            {f.help && <span className="text-[11px] text-faint">{f.help}</span>}
          </label>
        ))}
        {error && <ErrorState message={error} />}
        <div className="flex items-center justify-between gap-2">
          {spec.guide?.url ? (
            <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => call("shell", "open", { target: spec.guide!.url })}>
              {spec.guide.linkLabel ?? "Setup guide"}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Connect"}
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-faint">Your key is stored in Windows Credential Manager on this PC and goes only to {widget.name}.</p>
      </form>
    </CardFrame>
  );
}
