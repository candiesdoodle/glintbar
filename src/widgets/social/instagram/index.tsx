import { Camera } from "lucide-react";
import { siInstagram } from "simple-icons";
import { disconnectAccount, makeConnect } from "../../finance/shared/account";
import { socialWidget } from "../shared/social";
import { instagramAccount, loadInstagram, sampleInstagram } from "./api";

export default socialWidget({
  id: "social.instagram",
  name: "Instagram",
  description: "Your Instagram followers, via Meta's official API and your token.",
  keywords: ["instagram", "followers", "social", "meta", "creator"],
  glyph: siInstagram,
  icon: Camera,
  ns: instagramAccount.ns,
  word: "Followers",
  refreshMs: 60 * 60_000,
  load: loadInstagram,
  sample: sampleInstagram,
  Connect: makeConnect(instagramAccount),
  disconnect: () => disconnectAccount(instagramAccount),
  note: "While the dock runs, GlintBar renews Instagram-login tokens every week. Facebook-login tokens expire after 60 days, so make and extend a fresh one when that happens.",
});
