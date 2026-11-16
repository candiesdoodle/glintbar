import { Mail } from "lucide-react";
import { siResend } from "simple-icons";
import { seriesWidget } from "../../finance/shared/series";
import { loadResend, resendAccount, sampleResend } from "./api";

export default seriesWidget(
  {
    account: resendAccount,
    glyph: siResend,
    icon: Mail,
    label: "Emails",
    heroLabel: "Emails sent, last 7 days",
    refreshMs: 15 * 60_000,
    load: loadResend,
    sample: sampleResend,
    dashboardUrl: "https://resend.com/emails",
  },
  {
    id: "developer.resend",
    name: "Resend",
    category: "Developer",
    description: "Weekly email count from Resend and what percentage got delivered.",
    keywords: ["email", "transactional", "delivered", "sent"],
  },
);
