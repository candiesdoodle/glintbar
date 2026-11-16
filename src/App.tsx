import { AppearanceRoot } from "./appearance";
import { Dock } from "./dock/Dock";

export function App() {
  return (
    <>
      {/* Theme, accent and the live glass canvas (under the dock bar). */}
      <AppearanceRoot />
      <Dock />
    </>
  );
}
