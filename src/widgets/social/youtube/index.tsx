import { Play } from "lucide-react";
import { siYoutube } from "simple-icons";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { socialWidget } from "../shared/social";
import { loadYoutube, sampleYoutube, youtubeAccount } from "./api";

export default socialWidget({
  id: "social.youtube",
  name: "YouTube",
  description: "Subscriber count for your YouTube channel, using your API key.",
  keywords: ["youtube", "subscribers", "channel", "video", "creator"],
  glyph: siYoutube,
  icon: Play,
  ns: youtubeAccount.ns,
  word: "Subscribers",
  refreshMs: 30 * 60_000,
  load: loadYoutube,
  sample: sampleYoutube,
  Connect: makeConnect(youtubeAccount),
  disconnect: () => disconnectAccount(youtubeAccount),
});
