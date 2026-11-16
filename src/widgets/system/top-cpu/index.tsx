import { Gauge } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { TopAppsTile } from "../shared/TopApps";

export default defineWidget({
  id: "system.top-cpu",
  name: "Top CPU",
  category: "System",
  description: "Your three busiest apps by CPU; click to open Task Manager.",
  keywords: ["processes", "apps", "cpu", "task manager", "busy", "load"],
  icon: Gauge,
  size: "l",
  Tile: (p) => <TopAppsTile kind="cpu" size={p.size} isSample={p.isSample} />,
});
