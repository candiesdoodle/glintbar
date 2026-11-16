import { PlainError } from "../../finance/shared/poll";
import { oauthJson, type OAuthAccount } from "../../online/shared/oauth";
import type { SocialData } from "../shared/social";

/**
 * X needs an OAuth 2.0 app; GlintBar ships none, so the user registers their own (free) and
 * pastes its Client ID. Redirect: http://127.0.0.1:53127/callback.
 */
export const xAccount: OAuthAccount = {
  ns: "social.x",
  name: "X",
  vendor: "X",
  ids: ["social.x"],
  authUrl: "https://x.com/i/oauth2/authorize",
  tokenUrl: "https://api.x.com/2/oauth2/token",
  scopes: ["users.read", "tweet.read", "offline.access"],
  port: 53127,
  path: "/callback",
  secretOptional: true,
  basicAuthWithSecret: true,
  clientIdHelp: "Find it in your app under Keys and tokens → OAuth 2.0 Client ID. Leave the secret empty unless the client is confidential.",
  guide: {
    steps: [
      "In the X Developer Portal, make a Project with an App inside it (the free tier works).",
      "Edit the App's User authentication settings: enable OAuth 2.0, pick Native App (Web App works too) and give it read permissions.",
      "Save http://127.0.0.1:53127/callback as the Callback URI.",
      "Under Keys and tokens, copy the OAuth 2.0 Client ID, plus the Client secret when X gives you one.",
    ],
    url: "https://developer.x.com/en/portal/dashboard",
    linkLabel: "Open the X Developer Portal",
  },
};

export interface XMeResponse {
  data?: {
    id: string;
    name: string;
    username: string;
    public_metrics?: { followers_count?: number; following_count?: number; post_count?: number; tweet_count?: number; listed_count?: number };
  };
  errors?: Array<{ detail?: string; title?: string }>;
}

export function mapMe(res: XMeResponse): SocialData {
  const u = res.data;
  if (!u) throw new PlainError(`X: ${res.errors?.[0]?.detail ?? res.errors?.[0]?.title ?? "the reply had no profile"}`);
  const m = u.public_metrics ?? {};
  return {
    handle: `@${u.username}`,
    name: u.name,
    followers: m.followers_count ?? 0,
    stats: [
      { label: "Following", value: m.following_count ?? 0 },
      { label: "Posts", value: m.post_count ?? m.tweet_count ?? 0 },
      { label: "Listed", value: m.listed_count ?? 0 },
    ],
    url: `https://x.com/${u.username}`,
  };
}

export async function loadX(): Promise<SocialData> {
  return mapMe(await oauthJson<XMeResponse>(xAccount, "https://api.x.com/2/users/me", { query: { "user.fields": "public_metrics" } }));
}

export function sampleX(): SocialData {
  return {
    handle: "@you",
    name: "You",
    followers: 12480,
    stats: [
      { label: "Following", value: 612 },
      { label: "Posts", value: 3841 },
      { label: "Listed", value: 57 },
    ],
    url: "https://x.com/",
  };
}
