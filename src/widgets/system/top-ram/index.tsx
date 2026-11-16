import { MemoryStick } from "lucide-react";
import { defineWidget } from "../../../core/widget";
import { TopAppsTile } from "../shared/TopApps";

export default defineWidget({
  id: "system.top-ram",
  name: "Top RAM",
  category: "System",
  description: "Your three biggest RAM users, each app's processes counted together.",
  keywords: ["processes", "apps", "memory", "ram", "task manager"],
  icon: MemoryStick,
  size: "l",
  Tile: (p) => <TopAppsTile kind="ram" size={p.size} isSample={p.isSample} />,
});
