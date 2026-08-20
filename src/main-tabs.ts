export type WorkspaceView =
  | "office"
  | "briefing"
  | "knowledge"
  | "reflection"
  | "rules"
  | "meetings"
  | "automations"
  | "activity"
  | "health"
  | "settings"
  | "browser";

export type MainTab =
  | { id: `chat:${string}`; kind: "chat"; chatId: string }
  | { id: `view:${WorkspaceView}`; kind: "view"; view: WorkspaceView };

export type TabCloseAction = "close" | "close-others" | "close-right" | "close-all";

export function chatTab(chatId: string): MainTab {
  return { id: `chat:${chatId}`, kind: "chat", chatId };
}

export function viewTab(view: WorkspaceView): MainTab {
  return { id: `view:${view}`, kind: "view", view };
}

export function addMainTab(tabs: MainTab[], tab: MainTab): MainTab[] {
  return tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab];
}

export function closeMainTabs(
  tabs: MainTab[],
  targetId: string,
  action: TabCloseAction,
): MainTab[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) return tabs;
  if (action === "close-all") return [];
  if (action === "close-others") return [tabs[targetIndex]];
  if (action === "close-right") return tabs.slice(0, targetIndex + 1);
  return tabs.filter((tab) => tab.id !== targetId);
}

export function nextActiveMainTabId(
  before: MainTab[],
  after: MainTab[],
  targetId: string,
  activeId: string | undefined,
): string | undefined {
  if (activeId && after.some((tab) => tab.id === activeId)) return activeId;
  if (!after.length) return undefined;
  const targetIndex = Math.max(0, before.findIndex((tab) => tab.id === targetId));
  return after[Math.min(targetIndex, after.length - 1)]?.id;
}
