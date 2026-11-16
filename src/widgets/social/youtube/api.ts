import { HttpError, httpJson } from "../../../core/http";
import { guard, vendorDetail, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import type { SocialData } from "../shared/social";

export interface YtChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string; viewCount?: string };
  }>;
}

const NAME = "YouTube";

export function channelQuery(input: string): Record<string, string> {
  const s = input.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//i, "").replace(/\/.*$/, "");
  if (/^UC[\w-]{20,}$/.test(s)) return { id: s };
  if (!s) throw new PlainError("Fill in the channel handle, such as @yourname.");
  return { forHandle: s.startsWith("@") ? s : `@${s}` };
}

export function mapChannel(res: YtChannelsResponse): SocialData {
  const c = res.items?.[0];
  if (!c) throw new PlainError("No YouTube channel matches that handle. Use the @name shown on your channel page.");
  const st = c.statistics ?? {};
  if (st.hiddenSubscriberCount) throw new PlainError("The subscriber count is hidden on this channel. Make it public in YouTube Studio so the tile can read it.");
  const handle = c.snippet?.customUrl ?? c.id;
  return {
    handle,
    name: c.snippet?.title,
    followers: Number(st.subscriberCount ?? 0),
    approx: Number(st.subscriberCount ?? 0) >= 1000,
    stats: [
      { label: "Videos", value: Number(st.videoCount ?? 0) },
      { label: "Views", value: Number(st.viewCount ?? 0) },
    ],
    url: `https://www.youtube.com/${handle.startsWith("@") ? handle : `channel/${c.id}`}`,
  };
}

async function fetchChannel(ctx: Ctx): Promise<YtChannelsResponse> {
  try {
    return await httpJson<YtChannelsResponse>("https://www.googleapis.com/youtube/v3/channels", {
      query: { part: "snippet,statistics", ...channelQuery(ctx.settings.channel ?? ""), key: ctx.secret("apiKey") },
    });
  } catch (e) {
    // Google answers a bad key with 400 "API key not valid".
    if (e instanceof HttpError && /api key|keyInvalid|API_KEY/i.test(`${vendorDetail(e.detail)} ${e.detail ?? ""}`)) {
      throw new PlainError("That API key was rejected by YouTube. Paste it once more and make sure its Google Cloud project has YouTube Data API v3 turned on.");
    }
    return guard(NAME, () => Promise.reject(e), { forbidden: "That API key was rejected by YouTube. Its Google Cloud project needs YouTube Data API v3 turned on." });
  }
}

export async function loadYoutube(ctx: Ctx): Promise<SocialData> {
  return mapChannel(await fetchChannel(ctx));
}

export function sampleYoutube(): SocialData {
  return {
    handle: "@yourchannel",
    name: "Your Channel",
    followers: 48200,
    approx: true,
    stats: [
      { label: "Videos", value: 214 },
      { label: "Views", value: 3_870_000 },
    ],
    url: "https://www.youtube.com/",
  };
}

export const youtubeAccount: Account = {
  ns: "social.youtube",
  name: NAME,
  ids: ["social.youtube"],
  spec: {
    fields: [
      { key: "channel", label: "Channel", placeholder: "@yourchannel", help: "An @handle, or a channel ID that starts with UC…" },
      { key: "apiKey", label: "API key", secret: true, placeholder: "AIza…" },
    ],
    guide: {
      steps: ["In the Google Cloud console, pick a project or make a new one.", "Under APIs & Services → Library, turn on YouTube Data API v3.", "Under APIs & Services → Credentials, pick API key from the Create credentials menu, then copy the AIza… value."],
      url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
      linkLabel: "Open Google Cloud",
    },
    test: async (values) => {
      mapChannel(await fetchChannel({ secret: (f) => values[f] ?? "", settings: values, testing: true }));
    },
  },
};
