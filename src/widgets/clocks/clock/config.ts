import { useSettings } from "../../../core/store";

/** Per-instance options. "auto" follows Settings > General > Clock. */
export type ClockConfig = {
  format: "auto" | "12" | "24";
  seconds: "auto" | "on" | "off";
  showDate: boolean;
};

/** Resolves "auto" against the app settings. */
export function useClockPrefs(config: ClockConfig): { hour24: boolean; seconds: boolean } {
  const clock24h = useSettings((s) => s.clock24h);
  const showSeconds = useSettings((s) => s.showSeconds);
  return {
    hour24: config.format === "auto" ? clock24h : config.format === "24",
    seconds: config.seconds === "auto" ? showSeconds : config.seconds === "on",
  };
}
