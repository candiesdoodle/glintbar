import { useMemo, type CSSProperties } from "react";
import type { WidgetConfig, WidgetDef } from "../core/widget";
import { VisibleProvider } from "../core/useVisible";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { TileSizeContext } from "../ui/TileSampleBadge";

/** Renders one widget tile with merged config, visibility and crash isolation. */
export function TileHost({
  def,
  instanceId,
  config,
  height,
  isSample,
  visible,
  openCard,
  setConfig,
  fitContent = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: WidgetDef<any>;
  instanceId: string;
  config: WidgetConfig;
  height: number;
  isSample: boolean;
  visible: boolean;
  openCard: () => void;
  setConfig: (patch: WidgetConfig) => void;
  /** On the dock, a `fit: "content"` tile: the wrapper takes the content's width. */
  fitContent?: boolean;
}) {
  const merged = useMemo(() => ({ ...(def.defaultConfig ?? {}), ...config }), [def, config]);
  const Tile = def.Tile;
  return (
    <VisibleProvider value={visible}>
      <TileSizeContext.Provider value={height}>
      <ErrorBoundary name={def.id}>
        <div className={fitContent ? "h-full w-max" : "h-full w-full"} style={{ "--tile-h": `${height}px` } as CSSProperties}>
          <Tile instanceId={instanceId} config={merged} setConfig={setConfig} size={height} openCard={openCard} isSample={isSample} />
        </div>
      </ErrorBoundary>
      </TileSizeContext.Provider>
    </VisibleProvider>
  );
}
