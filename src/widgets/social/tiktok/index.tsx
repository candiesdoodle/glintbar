import { Music2 } from "lucide-react";
import { siTiktok } from "simple-icons";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { socialWidget } from "../shared/social";
import { loadTiktok, sampleTiktok, tiktokAccount } from "./api";

export default socialWidget({
  id: "social.tiktok",
  name: "TikTok",
  description: "The follower count of your public TikTok profile.",
  keywords: ["tiktok", "followers", "social", "creator", "likes"],
  glyph: siTiktok,
  icon: Music2,
  ns: tiktokAccount.ns,
  word: "Followers",
  refreshMs: 60 * 60_000,
  load: loadTiktok,
  sample: sampleTiktok,
  Connect: makeConnect(tiktokAccount),
  disconnect: () => disconnectAccount(tiktokAccount),
  note: "TikTok offers no follower API that GlintBar can use, so it loads your public profile page every hour.",
});
