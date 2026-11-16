import { relativeTime } from "../../../core/format";
import { startOfDay } from "../../finance/shared/sample";
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, googleGuide, oauthJson, type OAuthAccount } from "../shared/oauth";

export const gmailAccount: OAuthAccount = {
  ns: "online.gmail",
  name: "Gmail",
  vendor: "Google",
  ids: ["online.gmail"],
  authUrl: GOOGLE_AUTH_URL,
  tokenUrl: GOOGLE_TOKEN_URL,
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  extra: { access_type: "offline", prompt: "consent" },
  guide: {
    steps: [...googleGuide("Gmail API", "GlintBar Gmail"), "Enter both values below, press Save, then Sign in with Google."],
    url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    linkLabel: "Open Google Cloud",
  },
};

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function map403(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("has not been used") || d.includes("disabled")) return "Your Google Cloud project needs the Gmail API turned on (APIs & Services → Library). Retry after a minute.";
  return `Google: ${detail || "access denied"}`;
}

const get = <T,>(url: string, query?: Record<string, string | number | undefined>) => oauthJson<T>(gmailAccount, url, { query }, map403);

export interface GmailCounts {
  unread: number;
  today: number;
  todayMore: boolean;
}

export async function loadCounts(): Promise<GmailCounts> {
  const [label, today] = await Promise.all([
    get<{ messagesUnread?: number; threadsUnread?: number }>(`${API}/labels/INBOX`),
    get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`${API}/messages`, { q: `in:inbox after:${Math.floor(startOfDay(0).getTime() / 1000)}`, maxResults: 100 }),
  ]);
  return { unread: label.messagesUnread ?? 0, today: today.messages?.length ?? 0, todayMore: Boolean(today.nextPageToken) };
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  at: number;
  unread: boolean;
  starred: boolean;
}

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

/** '"Ada Lovelace" <ada@example.com>' -> 'Ada Lovelace' */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  if (m) return m[1].trim() || m[2];
  return from.trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function mapMessage(m: RawMessage): GmailMessage {
  const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: m.id,
    threadId: m.threadId,
    from: senderName(h("From")) || "(unknown sender)",
    subject: h("Subject") || "(no subject)",
    snippet: decodeEntities(m.snippet ?? ""),
    at: Number(m.internalDate ?? 0),
    unread: m.labelIds?.includes("UNREAD") ?? false,
    starred: m.labelIds?.includes("STARRED") ?? false,
  };
}

export type Mailbox = "unread" | "inbox" | "starred";

export async function loadList(box: Mailbox, search: string): Promise<GmailMessage[]> {
  const q = search.trim() ? search.trim() : box === "unread" ? "in:inbox is:unread" : box === "starred" ? "is:starred" : "in:inbox";
  const list = await get<{ messages?: Array<{ id: string }> }>(`${API}/messages`, { q, maxResults: 12 });
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: GmailMessage[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(
      ids.slice(i, i + 6).map((id) =>
        oauthJson<RawMessage>(gmailAccount, `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {}, map403),
      ),
    );
    out.push(...batch.map(mapMessage));
  }
  return out;
}

export function mailTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return relativeTime(at, now);
}

export function sampleCounts(): GmailCounts {
  return { unread: 12323, today: 38, todayMore: false };
}

export function sampleMessages(box: Mailbox): GmailMessage[] {
  const t = Date.now();
  const list: GmailMessage[] = [
    { id: "1", threadId: "1", from: "Maya Chen", subject: "Design review moved to Thursday", snippet: "Hi! Quick heads-up: we're moving the review to Thursday 3pm so everyone can join…", at: t - 18 * 60_000, unread: true, starred: true },
    { id: "2", threadId: "2", from: "GitHub", subject: "[acme/api] Fix flaky upload test (#482)", snippet: "@you approved these changes. LGTM once CI is green…", at: t - 55 * 60_000, unread: true, starred: false },
    { id: "3", threadId: "3", from: "Stripe", subject: "Your payout of $1,284.10 is on its way", snippet: "The payout should arrive in your bank account by Wednesday…", at: t - 3 * 3600_000, unread: false, starred: false },
    { id: "4", threadId: "4", from: "Jonas Weber", subject: "Re: invoice for October", snippet: "Thanks, got it. I'll forward it to accounting today.", at: t - 26 * 3600_000, unread: true, starred: true },
    { id: "5", threadId: "5", from: "Figma", subject: "Comments on Dock redesign", snippet: "Alex left 3 comments on Dock redesign · v4…", at: t - 2 * 86400_000, unread: false, starred: false },
  ];
  if (box === "unread") return list.filter((m) => m.unread);
  if (box === "starred") return list.filter((m) => m.starred);
  return list;
}
