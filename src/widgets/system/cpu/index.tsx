import { Cpu } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { CpuTile } from "./CpuTile";

/**
 * Reference widget with a Rust service: `system.cpu_info` (one-shot) and the demand-driven
 * `system/cpu` topic (1 s). See src-tauri/src/services/system and ../mock.ts.
 */
export default defineWidget({
  id: "system.cpu",
  name: "CPU",
  category: "System",
  description: "Overall CPU usage in a circle, plus a 60-second chart when you open it.",
  keywords: ["processor", "load", "usage", "performance", "task manager"],
  icon: Cpu,
  size: "m",
  Tile: CpuTile,
  Card: lazyPart(() => import("./CpuCard").then((m) => m.CpuCard)),
  cardSize: { width: 340 },
});
