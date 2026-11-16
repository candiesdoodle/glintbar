import { Coins } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { CurrencyTile } from "./CurrencyTile";
import { DEFAULT_CURRENCY, type CurrencyConfig } from "./types";

export default defineWidget<CurrencyConfig>({
  id: "productivity.currency",
  name: "Currency",
  category: "Productivity",
  description: "Converts an amount between currencies at the latest rates.",
  keywords: ["exchange", "rates", "money", "convert", "forex", "dollar", "euro"],
  icon: Coins,
  size: "l",
  Tile: CurrencyTile,
  Card: lazyPart(() => import("./CurrencyCard").then((m) => m.CurrencyCard)),
  cardSize: { width: 340 },
  defaultConfig: DEFAULT_CURRENCY,
});
