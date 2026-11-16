/** One follower-count widget shape for X, TikTok, YouTube and Instagram. */
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { shortNumber } from "../../../core/format";
import { defineWidget, type CardProps, type TileProps, type WidgetDef } from "../../../core/widget";
import { CardFrame, Stat } from "../../../ui";
import type { Ctx } from "../../finance/shared/account";
import { AccountFooter, CardHero, CardStatus, MetricTile, StatGrid, statusOf, type Glyph } from "../../finance/shared/kit";
import { useAccountData } from "../../finance/shared/useAccount";

export interface SocialData {
  handle: string;
  name?: string;
  followers: number;
  /** Subscriber counts YouTube rounds, etc. */
  approx?: boolean;
  stats: Array<{ label: string; value: number }>;
  url: string;
}

export interface SocialSpec {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  glyph: Glyph;
  icon: LucideIcon;
  ns: string;
  /** "Followers" or "Subscribers". */
  word: string;
  refreshMs: number;
  load: (ctx: Ctx) => Promise<SocialData>;
  sample: () => SocialData;
  Connect: ComponentType<CardProps>;
  disconnect: () => Promise<void>;
  /** Right-click wording for `disconnect` ("Sign out" for OAuth). */
  disconnectLabel?: string;
  /** Extra line under the card (e.g. how the number is read). */
  note?: string;
}

export function socialWidget(s: SocialSpec): WidgetDef {
  const use = (isSample: boolean) => useAccountData({ ns: s.ns }, isSample, s.load, s.sample, { refreshMs: s.refreshMs });
  const Tile = ({ size, isSample }: TileProps) => {
    const { data, poll } = use(isSample);
    return (
      <MetricTile
        glyph={s.glyph}
        label={s.word}
        value={data ? shortNumber(data.followers) : "–"}
        size={size}
        isSample={isSample}
        status={statusOf(poll, isSample)}
        title={data ? `${data.handle}: ${data.followers.toLocaleString()} ${s.word.toLowerCase()}` : undefined}
      />
    );
  };
  const Card = ({ isSample, close }: CardProps) => {
    const { data, poll } = use(isSample);
    return (
      <CardFrame
        title={s.name}
        subtitle={data ? (data.name ? `${data.name} · ${data.handle}` : data.handle) : s.description}
        icon={s.icon}
        footer={
          <AccountFooter
            url={data?.url}
            urlLabel="Open profile"
            onDisconnect={
              isSample
                ? undefined
                : () => {
                    void s.disconnect();
                    close();
                  }
            }
          />
        }
      >
        <CardHero label={s.word} value={data ? data.followers.toLocaleString() : "–"} sub={data?.approx ? "the platform rounds this" : undefined} />
        {data && data.stats.length > 0 && (
          <StatGrid cols={data.stats.length >= 3 ? 3 : 2}>
            {data.stats.map((st) => (
              <Stat key={st.label} label={st.label} value={shortNumber(st.value)} sub={st.value >= 1000 ? st.value.toLocaleString() : undefined} />
            ))}
          </StatGrid>
        )}
        {s.note && <p className="mt-3 text-[11px] leading-snug text-faint">{s.note}</p>}
        <CardStatus poll={poll} isSample={isSample} sampleText={`These are sample figures. Connect ${s.name.replace(/ Profile$/, "")} to load your own.`} />
      </CardFrame>
    );
  };
  return defineWidget({
    id: s.id,
    name: s.name,
    category: "Social",
    description: s.description,
    keywords: s.keywords,
    icon: s.icon,
    size: "m",
    Tile,
    Card,
    Connect: s.Connect,
    disconnect: s.disconnect,
    disconnectLabel: s.disconnectLabel,
    cardSize: { width: 320 },
  });
}
