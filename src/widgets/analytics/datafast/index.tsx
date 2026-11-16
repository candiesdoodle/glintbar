import { BarChart3 } from "lucide-react";
import { monogram } from "../../finance/shared/kit";
import { seriesWidget } from "../../finance/shared/series";
import { datafastAccount, loadDatafast, sampleDatafast } from "./api";

export default seriesWidget(
  {
    account: datafastAccount,
    glyph: monogram("DF"),
    icon: BarChart3,
    label: "DataFast",
    heroLabel: "Visitors, last 7 days",
    refreshMs: 10 * 60_000,
    load: loadDatafast,
    sample: sampleDatafast,
    dashboardUrl: "https://datafa.st/dashboard",
  },
  {
    id: "analytics.datafast",
    name: "DataFast Chart",
    category: "Analytics",
    description: "Daily DataFast visitors for two weeks, and this week vs last.",
    keywords: ["visitors", "traffic", "analytics", "website", "datafast"],
  },
);
