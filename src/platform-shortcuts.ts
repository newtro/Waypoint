export function primaryShortcutLabel(platform: string): string {
  return platform === "darwin" ? "⌘" : "Ctrl";
}

export function knowledgeShortcutIcon(platform: string): string {
  return platform === "darwin" ? "⌘" : "◈";
}

export function primaryShortcutPressed(
  platform: string,
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
): boolean {
  return platform === "darwin" ? event.metaKey : event.ctrlKey;
}
