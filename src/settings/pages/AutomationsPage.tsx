import type { ComponentType } from "react";
import { Zap } from "lucide-react";
import { EmptyState } from "../../ui/States";

/**
 * The automations slice owns this page. It is picked up from src/automations if one of these
 * files exists, using its default export or an export named AutomationsPage / SettingsPage:
 *   src/automations/SettingsPage.tsx, AutomationsPage.tsx, Page.tsx, index.tsx
 */
type PageModule = { default?: ComponentType; AutomationsPage?: ComponentType; SettingsPage?: ComponentType };

const modules = import.meta.glob<PageModule>("../../automations/{SettingsPage,AutomationsPage,Page,index}.tsx", { eager: true });

function findPage(): ComponentType | null {
  for (const name of ["SettingsPage", "AutomationsPage", "Page", "index"]) {
    const mod = Object.entries(modules).find(([path]) => path.endsWith(`/${name}.tsx`))?.[1];
    const page = mod?.AutomationsPage ?? mod?.SettingsPage ?? mod?.default;
    if (page) return page;
  }
  return null;
}

const Page = findPage();

export function AutomationsPage() {
  if (Page) return <Page />;
  return (
    <EmptyState
      icon={Zap}
      title="Automations are coming"
      message="Planned: pausing music for meetings, warnings when an AI limit is close, plan renewal reminders and quiet hours. Each will get its own switch on this page."
    />
  );
}
