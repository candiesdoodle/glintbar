import { LogOut, Zap } from "lucide-react";
import { disconnect } from "../../../core/connections";
import { defineWidget } from "../../../core/widget";
import { Button } from "../../../ui";
import { limitSource } from "../shared/data";
import { testGlmKey } from "../shared/glm";
import { makeLimitCard, makeLimitTile } from "../shared/limitWidget";

const opts = { tool: "glm", widgetId: "ai.glm" } as const;

function GlmDisconnect({ sample }: { sample: boolean }) {
  if (sample) return null;
  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        icon={LogOut}
        onClick={() => {
          limitSource("glm").forget();
          void disconnect(def);
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}

/** GLM Coding Plan windows (5-hour, weekly where the plan has it, MCP calls) with a pasted key. */
const def = defineWidget({
  id: "ai.glm",
  name: "GLM Usage",
  category: "AI",
  description: "GLM Coding Plan use on Z.ai or Zhipu: 5-hour, weekly and MCP calls.",
  keywords: ["zai", "z.ai", "zhipu", "bigmodel", "glm", "coding plan", "mcp", "limit"],
  icon: Zap,
  size: "l",
  Tile: makeLimitTile(opts),
  Card: makeLimitCard({ ...opts, extra: GlmDisconnect }),
  connect: {
    fields: [{ key: "apiKey", label: "API key", secret: true, placeholder: "Key from Z.ai or BigModel…" }],
    guide: {
      steps: ["Sign in to Z.ai (Zhipu BigModel works too), open API Keys and make a new key.", "Paste it into the field below. GlintBar tests it with one quota request, trying Z.ai first, then BigModel."],
      url: "https://z.ai/manage-apikey/apikey-list",
      linkLabel: "Open Z.ai API keys",
    },
    test: (v) => testGlmKey(v.apiKey ?? ""),
  },
  cardSize: { width: 340 },
});

export default def;
