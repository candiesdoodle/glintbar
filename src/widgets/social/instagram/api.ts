import { HttpError, httpJson } from "../../../core/http";
import { secrets } from "../../../core/secrets";
import { guard, setSetting, vendorDetail, type Account, type Ctx } from "../../finance/shared/account";
import { PlainError } from "../../finance/shared/poll";
import type { SocialData } from "../shared/social";

const NAME = "Instagram";
const NS = "social.instagram";
const V = "v27.0";
const RENEW_EVERY = 7 * 86_400_000;

export interface IgMe {
  user_id?: string;
  id?: string;
  username?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  account_type?: string;
}
export interface FbAccounts {
  data?: Array<{ name?: string; instagram_business_account?: IgMe }>;
}

function toSocial(u: IgMe): SocialData {
  if (u.followers_count === undefined) throw new PlainError("Follower counts are only available for professional accounts. In the Instagram app, change the account type to Business or Creator.");
  return {
    handle: `@${u.username ?? "instagram"}`,
    followers: u.followers_count,
    stats: [
      { label: "Posts", value: u.media_count ?? 0 },
      ...(u.follows_count !== undefined ? [{ label: "Following", value: u.follows_count }] : []),
    ],
    url: `https://www.instagram.com/${u.username ?? ""}`,
  };
}

export function mapIgMe(u: IgMe): SocialData {
  return toSocial(u);
}

/** Facebook-login tokens reach Instagram accounts through the Pages they are linked to. */
export function mapFbAccounts(res: FbAccounts, wanted: string): SocialData {
  const igs = (res.data ?? []).map((p) => p.instagram_business_account).filter((x): x is IgMe => Boolean(x));
  if (!igs.length) throw new PlainError("No Instagram account is reachable with this token. Link a Facebook Page to your professional account, then grant the token the pages_show_list and instagram_basic permissions.");
  const w = wanted.trim().replace(/^@/, "").toLowerCase();
  const hit = (w && igs.find((u) => u.username?.toLowerCase() === w)) || igs[0];
  return toSocial(hit);
}

async function viaInstagram(ctx: Ctx): Promise<SocialData> {
  const u = await httpJson<IgMe>(`https://graph.instagram.com/${V}/me`, { query: { fields: "user_id,username,followers_count,follows_count,media_count,account_type", access_token: ctx.secret("token") } });
  return mapIgMe(u);
}

async function viaFacebook(ctx: Ctx): Promise<SocialData> {
  const res = await httpJson<FbAccounts>(`https://graph.facebook.com/${V}/me/accounts`, {
    query: { fields: "name,instagram_business_account{id,username,followers_count,follows_count,media_count}", access_token: ctx.secret("token") },
  });
  return mapFbAccounts(res, ctx.settings.username ?? "");
}

const rejected = (e: unknown) => e instanceof HttpError && (e.kind === "unauthorized" || e.kind === "bad_response" || e.kind === "forbidden");

/** Tries the kind of token we saw last first, then the other one. */
async function load(ctx: Ctx): Promise<{ data: SocialData; kind: "ig" | "fb" }> {
  const order: Array<"ig" | "fb"> = ctx.settings.kind === "fb" ? ["fb", "ig"] : ["ig", "fb"];
  let first: unknown;
  for (const kind of order) {
    try {
      const data = kind === "ig" ? await viaInstagram(ctx) : await viaFacebook(ctx);
      return { data, kind };
    } catch (e) {
      if (e instanceof PlainError) throw e;
      if (!rejected(e)) throw e;
      first ??= e;
    }
  }
  const detail = first instanceof HttpError ? vendorDetail(first.detail) : "";
  throw new PlainError(`Instagram refused the token: it has expired or was not copied in full - make a new one.${detail ? ` (${detail})` : ""}`);
}

/** Instagram-login tokens last 60 days; renewing weekly keeps them alive while the dock runs. */
async function renewIfDue(ctx: Ctx): Promise<void> {
  const last = Number(ctx.settings.renewedAt ?? 0);
  if (Date.now() - last < RENEW_EVERY) return;
  try {
    const res = await httpJson<{ access_token?: string }>("https://graph.instagram.com/refresh_access_token", { query: { grant_type: "ig_refresh_token", access_token: ctx.secret("token") } });
    if (res.access_token) await secrets.set(`${NS}.token`, res.access_token);
    setSetting({ ns: NS }, "renewedAt", String(Date.now()));
  } catch {
    // Too new to renew (< 24 h) or not renewable: try again tomorrow.
    setSetting({ ns: NS }, "renewedAt", String(Date.now() - RENEW_EVERY + 86_400_000));
  }
}

export async function loadInstagram(ctx: Ctx): Promise<SocialData> {
  const { data, kind } = await guard(NAME, () => load(ctx));
  if (!ctx.testing) {
    if (ctx.settings.kind !== kind) setSetting({ ns: NS }, "kind", kind);
    if (kind === "ig") await renewIfDue(ctx);
  }
  return data;
}

export function sampleInstagram(): SocialData {
  return {
    handle: "@you",
    followers: 23600,
    stats: [
      { label: "Posts", value: 412 },
      { label: "Following", value: 388 },
    ],
    url: "https://www.instagram.com/",
  };
}

export const instagramAccount: Account = {
  ns: NS,
  name: NAME,
  ids: ["social.instagram"],
  spec: {
    fields: [
      { key: "username", label: "Username", optional: true, placeholder: "@yourname", help: "Only needed when the token can see several accounts: names the one to show." },
      { key: "token", label: "Token", secret: true, placeholder: "IGAA… or EAA…", help: "Made in Meta's Instagram API setup, with either Instagram login or Facebook login." },
    ],
    guide: {
      steps: [
        "In Meta for Developers, make a new app with the Business type, then add the Instagram product to it.",
        "For Instagram login, add your professional account, then press Generate token (IGAA…).",
        "For Facebook login instead, use the Graph API Explorer to add pages_show_list and instagram_basic, make a token and extend it to 60 days (EAA…).",
      ],
      url: "https://developers.facebook.com/apps/",
      linkLabel: "Open Meta for Developers",
    },
    test: async (values) => {
      await loadInstagram({ secret: (f) => values[f] ?? "", settings: values, testing: true });
    },
  },
};
