import {
  Activity,
  Bluetooth,
  Crop,
  Download,
  Folder,
  HardDrive,
  LayoutGrid,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Power,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Trash2,
  Volume2,
  Wifi,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  bluetooth: Bluetooth,
  crop: Crop,
  download: Download,
  folder: Folder,
  drive: HardDrive,
  grid: LayoutGrid,
  lock: Lock,
  logout: LogOut,
  monitor: Monitor,
  moon: Moon,
  power: Power,
  rotate: RotateCcw,
  settings: Settings,
  sliders: SlidersHorizontal,
  trash: Trash2,
  volume: Volume2,
  wifi: Wifi,
};

export function CommandIcon({ name, size }: { name: string; size: number }) {
  const Icon = ICONS[name] ?? Settings;
  return (
    <span className="grid shrink-0 place-items-center rounded-md bg-accent/15 text-accent" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.6)} />
    </span>
  );
}
