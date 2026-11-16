import { MousePointerClick } from "lucide-react";
import { monogram } from "../../finance/shared/kit";
import { seriesWidget } from "../../finance/shared/series";
import { dubAccount, loadDub, sampleDub } from "./api";

export default seriesWidget(
  {
    account: dubAccount,
    glyph: monogram("D"),
    icon: MousePointerClick,
    label: "Clicks",
    heroLabel: "Link clicks, last 7 days",
    refreshMs: 10 * 60_000,
    load: loadDub,
    sample: sampleDub,
    dashboardUrl: "https://app.dub.co/",
  },
  {
    id: "analytics.dub",
    name: "Dub",
    category: "Analytics",
    description: "Weekly clicks on your Dub short links, plus a 14-day chart.",
    keywords: ["links", "clicks", "short links", "analytics"],
  },
);
