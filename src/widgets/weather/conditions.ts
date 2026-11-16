/** WMO weather codes (as Open-Meteo reports them) to words and icons. */
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";

export interface Condition {
  label: string;
  icon: LucideIcon;
  /** A theme colour for the icon. */
  tone: string;
}

const SUN = "#f5b324";
const CLOUD = "var(--g-dim)";
const RAIN = "#4ea3ff";
const SNOW = "#9fd8ff";
const STORM = "#b28cff";

export function condition(code: number, isDay = true): Condition {
  switch (code) {
    case 0:
      return { label: "Clear", icon: isDay ? Sun : Moon, tone: isDay ? SUN : "#c9cff7" };
    case 1:
      return { label: "Mostly clear", icon: isDay ? CloudSun : CloudMoon, tone: isDay ? SUN : "#c9cff7" };
    case 2:
      return { label: "Partly cloudy", icon: isDay ? CloudSun : CloudMoon, tone: isDay ? SUN : "#c9cff7" };
    case 3:
      return { label: "Overcast", icon: Cloudy, tone: CLOUD };
    case 45:
    case 48:
      return { label: "Fog", icon: CloudFog, tone: CLOUD };
    case 51:
    case 53:
    case 55:
      return { label: "Drizzle", icon: CloudDrizzle, tone: RAIN };
    case 56:
    case 57:
      return { label: "Freezing drizzle", icon: CloudDrizzle, tone: SNOW };
    case 61:
      return { label: "Light rain", icon: CloudRain, tone: RAIN };
    case 63:
      return { label: "Rain", icon: CloudRain, tone: RAIN };
    case 65:
      return { label: "Heavy rain", icon: CloudRain, tone: RAIN };
    case 66:
    case 67:
      return { label: "Freezing rain", icon: CloudHail, tone: SNOW };
    case 71:
      return { label: "Light snow", icon: CloudSnow, tone: SNOW };
    case 73:
      return { label: "Snow", icon: CloudSnow, tone: SNOW };
    case 75:
      return { label: "Heavy snow", icon: Snowflake, tone: SNOW };
    case 77:
      return { label: "Snow grains", icon: Snowflake, tone: SNOW };
    case 80:
      return { label: "Showers", icon: CloudRain, tone: RAIN };
    case 81:
      return { label: "Heavy showers", icon: CloudRain, tone: RAIN };
    case 82:
      return { label: "Violent showers", icon: CloudRain, tone: RAIN };
    case 85:
    case 86:
      return { label: "Snow showers", icon: CloudSnow, tone: SNOW };
    case 95:
      return { label: "Thunderstorm", icon: CloudLightning, tone: STORM };
    case 96:
    case 99:
      return { label: "Thunderstorm with hail", icon: CloudLightning, tone: STORM };
    default:
      return { label: "Cloudy", icon: Cloud, tone: CLOUD };
  }
}

/** "Light rain in Berlin", "Clear in Lisbon". */
export function sentence(code: number, isDay: boolean, place: string): string {
  const c = condition(code, isDay).label;
  return place ? `${c} in ${place}` : c;
}
