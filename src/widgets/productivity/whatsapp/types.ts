/** Mirrors src-tauri/src/services/productivity/whatsapp.rs. */
export type WhatsAppAccess = "allowed" | "denied" | "unspecified" | "unavailable";

export interface WhatsAppChat {
  name: string;
  count: number;
  lastAt: number;
}

export interface WhatsAppStatus {
  access: WhatsAppAccess;
  unread: number;
  lastSender: string | null;
  lastAt: number | null;
  chats: WhatsAppChat[];
  message: string | null;
}

export const SAMPLE_STATUS: WhatsAppStatus = {
  access: "allowed",
  unread: 5,
  lastSender: "Sam",
  lastAt: Date.now() - 6 * 60_000,
  chats: [
    { name: "Sam", count: 2, lastAt: Date.now() - 6 * 60_000 },
    { name: "Family", count: 3, lastAt: Date.now() - 40 * 60_000 },
  ],
  message: null,
};
