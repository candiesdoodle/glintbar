import { describe, expect, it } from "vitest";
import { mapFbAccounts, mapIgMe } from "./instagram/api";
import { cleanUser, parseProfile } from "./tiktok/api";
import { mapMe } from "./x/api";
import { channelQuery, mapChannel } from "./youtube/api";

describe("social mappings", () => {
  it("YouTube channels.list", () => {
    const d = mapChannel({ items: [{ id: "UC123", snippet: { title: "Chan", customUrl: "@chan" }, statistics: { subscriberCount: "48200", videoCount: "214", viewCount: "3870000", hiddenSubscriberCount: false } }] });
    expect(d.followers).toBe(48200);
    expect(d.stats).toEqual([
      { label: "Videos", value: 214 },
      { label: "Views", value: 3870000 },
    ]);
    expect(d.url).toBe("https://www.youtube.com/@chan");
    expect(() => mapChannel({ items: [] })).toThrow(/No YouTube channel/);
    expect(channelQuery("chan")).toEqual({ forHandle: "@chan" });
    expect(channelQuery("https://www.youtube.com/@chan/videos")).toEqual({ forHandle: "@chan" });
    expect(channelQuery("UCabcdefghijklmnopqrstuv")).toEqual({ id: "UCabcdefghijklmnopqrstuv" });
  });

  it("X users/me public_metrics", () => {
    const d = mapMe({ data: { id: "1", name: "Ada", username: "ada", public_metrics: { followers_count: 12480, following_count: 612, post_count: 3841, listed_count: 57 } } });
    expect(d).toMatchObject({ handle: "@ada", followers: 12480, url: "https://x.com/ada" });
    expect(d.stats[1]).toEqual({ label: "Posts", value: 3841 });
  });

  it("TikTok embedded profile JSON", () => {
    const json = JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode: 0, userInfo: { user: { uniqueId: "ada", nickname: "Ada", privateAccount: false }, stats: { followerCount: 86300, followingCount: 241, heartCount: 1940000, videoCount: 173 } } } } });
    const html = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${json}</script></html>`;
    const d = parseProfile(html, "ada");
    expect(d.followers).toBe(86300);
    expect(d.stats[0]).toEqual({ label: "Likes", value: 1940000 });
    expect(() => parseProfile("<html></html>", "ada")).toThrow(/without profile data/);
    const priv = html.replace('"privateAccount":false', '"privateAccount":true');
    expect(() => parseProfile(priv, "ada")).toThrow(/private/);
    expect(cleanUser("https://www.tiktok.com/@ada?lang=en")).toBe("ada");
  });

  it("Instagram: both token kinds", () => {
    expect(mapIgMe({ username: "ada", followers_count: 23600, media_count: 412, follows_count: 388 }).followers).toBe(23600);
    expect(() => mapIgMe({ username: "ada" })).toThrow(/professional/);
    const fb = { data: [{ name: "Page A", instagram_business_account: { username: "brand", followers_count: 10, media_count: 1 } }, { name: "Page B", instagram_business_account: { username: "ada", followers_count: 99, media_count: 3 } }, { name: "Page C" }] };
    expect(mapFbAccounts(fb, "@ada").followers).toBe(99);
    expect(mapFbAccounts(fb, "").followers).toBe(10);
    expect(() => mapFbAccounts({ data: [{ name: "x" }] }, "")).toThrow(/No Instagram account is reachable/);
  });
});
