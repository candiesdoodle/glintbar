import { httpText } from "../../../core/http";
import { guard, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import type { SocialData } from "../shared/social";

const NAME = "TikTok";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function cleanUser(input: string): string {
  return input.trim().replace(/^https?:\/\/(www\.)?tiktok\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "");
}

interface Stats {
  followerCount?: number;
  followingCount?: number;
  heartCount?: number;
  heart?: number;
  videoCount?: number;
}

/** Reads the numbers TikTok embeds in its public profile page. */
export function parseProfile(html: string, user: string): SocialData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let info: any;
  const m = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (m) {
    try {
      const detail = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
      if (detail && detail.statusCode && detail.statusCode !== 0 && !detail.userInfo) throw new PlainError("No public TikTok profile uses that name. Enter the @username exactly as your profile shows it.");
      info = detail?.userInfo;
    } catch (e) {
      if (e instanceof PlainError) throw e;
    }
  }
  if (!info) {
    const s = /<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (s) {
      try {
        const j = JSON.parse(s[1]);
        const key = Object.keys(j?.UserModule?.users ?? {})[0];
        if (key) info = { user: j.UserModule.users[key], stats: j.UserModule.stats?.[key] };
      } catch {
        /* fall through */
      }
    }
  }
  if (!info?.stats) throw new PlainError("The TikTok page came back without profile data. GlintBar retries in an hour.");
  if (info.user?.privateAccount) throw new PlainError("This TikTok account is private, so its numbers are visible only to its followers.");
  const st: Stats = info.stats;
  return {
    handle: `@${info.user?.uniqueId ?? user}`,
    name: info.user?.nickname,
    followers: st.followerCount ?? 0,
    stats: [
      { label: "Likes", value: st.heartCount ?? st.heart ?? 0 },
      { label: "Videos", value: st.videoCount ?? 0 },
      { label: "Following", value: st.followingCount ?? 0 },
    ],
    url: `https://www.tiktok.com/@${info.user?.uniqueId ?? user}`,
  };
}

export async function loadTiktok(ctx: Ctx): Promise<SocialData> {
  const user = cleanUser(ctx.settings.username ?? "");
  if (!user) throw new PlainError("Fill in your TikTok @username.");
  const html = await guard(NAME, () => httpText(`https://www.tiktok.com/@${encodeURIComponent(user)}`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" }, timeoutMs: 25_000 }), {
    notFound: "No public TikTok profile uses that name. Enter the @username exactly as your profile shows it.",
  });
  return parseProfile(html, user);
}

export function sampleTiktok(): SocialData {
  return {
    handle: "@you",
    name: "You",
    followers: 86300,
    stats: [
      { label: "Likes", value: 1_940_000 },
      { label: "Videos", value: 173 },
      { label: "Following", value: 241 },
    ],
    url: "https://www.tiktok.com/",
  };
}

export const tiktokAccount: Account = {
  ns: "social.tiktok",
  name: NAME,
  ids: ["social.tiktok"],
  spec: {
    fields: [{ key: "username", label: "Username", placeholder: "@yourname", help: "Must be a public profile. No password or key required." }],
    guide: { steps: ["Enter the @username of a public TikTok profile."], url: "https://www.tiktok.com/", linkLabel: "Open TikTok" },
    test: async (values) => {
      await loadTiktok({ secret: () => "", settings: values, testing: true });
    },
  },
};
