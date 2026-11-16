import type { TileProps } from "../../../core/widget";
import { TileFrame } from "../../../ui";
import { TileSampleBadge } from "../shared/TileBadge";
import { CurrencyChip } from "./CurrencyChip";
import { convert, formatAmount, SAMPLE_RATES, useRates } from "./rates";
import type { CurrencyConfig } from "./types";

export function CurrencyTile({ config, size, isSample }: TileProps<CurrencyConfig>) {
  const { rates } = useRates(!isSample);
  const table = !isSample && rates ? rates.rates : SAMPLE_RATES;
  const sample = isSample || !rates;
  const value = convert(config.amount, config.from, config.to, table);
  const big = Math.max(12, Math.round(size * 0.34));
  const small = Math.max(9, Math.round(size * 0.22));
  const chip = Math.round(size * 0.42);
  return (
    <TileFrame className="gap-[calc(var(--tile-h)*0.14)]" title={`${config.amount} ${config.from} → ${config.to}`}>
      {sample && <TileSampleBadge />}
      <div className="relative shrink-0" style={{ width: chip * 1.7, height: chip * 1.35 }}>
        <span className="absolute top-0 left-0 rounded-full ring-2 ring-[var(--g-tile)]"><CurrencyChip code={config.from} size={chip} /></span>
        <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-[var(--g-bar)]"><CurrencyChip code={config.to} size={chip} /></span>
      </div>
      <div className="min-w-0 flex-1 leading-none">
        <div className={"flex items-center gap-1 text-dim" + (sample ? " pr-[30px]" : "")} style={{ fontSize: small }}>
          <span className="truncate tabular-nums">{formatAmount(config.amount, config.from, true)} =</span>
        </div>
        <div className="mt-[3px] truncate font-semibold tabular-nums" style={{ fontSize: big }}>
          {value === null ? "–" : formatAmount(value, config.to)} <span className="font-medium text-dim" style={{ fontSize: Math.round(big * 0.6) }}>{config.to}</span>
        </div>
      </div>
    </TileFrame>
  );
}
