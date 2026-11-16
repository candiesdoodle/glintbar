import { AtSign } from "lucide-react";
import { siX } from "simple-icons";
import { makeOAuthConnect, signOut } from "../../online/shared/oauth";
import { socialWidget } from "../shared/social";
import { loadX, sampleX, xAccount } from "./api";

export default socialWidget({
  id: "social.x",
  name: "X Profile",
  description: "How many people follow your X account.",
  keywords: ["x", "twitter", "followers", "social"],
  glyph: siX,
  icon: AtSign,
  ns: xAccount.ns,
  word: "Followers",
  refreshMs: 60 * 60_000,
  load: loadX,
  sample: sampleX,
  Connect: makeOAuthConnect(xAccount),
  disconnect: () => signOut(xAccount),
  disconnectLabel: "Sign out",
  note: "Uses an X app that you own. During sign-in GlintBar briefly opens local port 53127 to catch X's reply, then closes it.",
});
