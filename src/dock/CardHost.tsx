import { Suspense, useCallback, useMemo, type ReactNode } from "react";
import { useIsSample } from "../core/connections";
import { useWidget } from "../core/registry";
import { VisibleProvider } from "../core/useVisible";
import type { WidgetDef } from "../core/widget";
import { ConnectForm } from "../ui/ConnectForm";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { dockActions, useDock, type WidgetInstance } from "./layout";
import { Popover } from "./Popover";
import { useDockUi, type Anchor } from "./ui";

/** The open card, anchored over its tile. Shows the connect form while a widget is a sample. */
export function CardHost() {
  const card = useDockUi((s) => s.card);
  const inst = useDock((s) => (card ? s.instances.find((i) => i.instanceId === card.instanceId) : undefined));
  const def = useWidget(inst?.widgetId ?? "");
  if (!card || !inst || !def) return null;
  return <CardBody key={inst.instanceId} def={def} inst={inst} anchor={card.anchor} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CardBody({ def, inst, anchor }: { def: WidgetDef<any>; inst: WidgetInstance; anchor: Anchor }) {
  const isSample = useIsSample(def);
  const config = useMemo(() => ({ ...(def.defaultConfig ?? {}), ...inst.config }), [def, inst.config]);
  const setConfig = useCallback((patch: Record<string, unknown>) => dockActions.setConfig(inst.instanceId, patch), [inst.instanceId]);
  const close = useCallback(() => useDockUi.setState({ card: null }), []);

  const props = { instanceId: inst.instanceId, config, setConfig, close, isSample };
  let content: ReactNode = null;
  const Connect = def.Connect;
  const Card = def.Card;
  if (isSample && Connect) content = <Connect {...props} />;
  else if (isSample && def.connect) content = <ConnectForm widget={def} config={config} setConfig={setConfig} />;
  else if (Card) content = <Card {...props} />;
  if (!content) return null;

  return (
    <Popover id="card" instanceId={inst.instanceId} anchor={anchor} width={def.cardSize?.width ?? 320} maxHeight={def.cardSize?.height}>
      <VisibleProvider value={true}>
        <ErrorBoundary name={def.id} fallback={<div className="p-4 text-[12px] text-bad">This card ran into an error.</div>}>
          <Suspense fallback={<CardLoading />}>{content}</Suspense>
        </ErrorBoundary>
      </VisibleProvider>
    </Popover>
  );
}

/** While a card's code loads (cards are split from their widget): a quiet placeholder. */
function CardLoading() {
  return (
    <div className="space-y-2.5 p-4" aria-busy="true">
      <div className="h-4 w-1/3 animate-pulse rounded bg-track" />
      <div className="h-16 animate-pulse rounded-[10px] bg-track" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-track" />
    </div>
  );
}
