import { BarChart3 } from "lucide-react";
import { siPlausibleanalytics } from "simple-icons";
import { seriesWidget } from "../../finance/shared/series";
import { loadPlausible, plausibleAccount, samplePlausible } from "./api";

export default seriesWidget(
  {
    account: plausibleAccount,
    glyph: siPlausibleanalytics,
    icon: BarChart3,
    label: "Visitors",
    heroLabel: "Unique visitors, last 7 days",
    refreshMs: 10 * 60_000,
    load: loadPlausible,
    sample: samplePlausible,
    dashboardUrl: "https://plausible.io/sites",
  },
  {
    id: "analytics.plausible",
    name: "Plausible",
    category: "Analytics",
    description: "Your Plausible visitor count for the week and a 14-day chart.",
    keywords: ["visitors", "traffic", "analytics", "website", "privacy"],
  },
);
