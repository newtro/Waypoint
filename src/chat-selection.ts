export function reconcileSelectedChatId(chats: Array<{ id: string }>, current?: string): string | undefined {
  if (current && chats.some((chat) => chat.id === current)) return current
  return chats[0]?.id
}

export class RefreshGate {
  private latest = 0
  begin(): number { this.latest += 1; return this.latest }
  isCurrent(token: number): boolean { return token === this.latest }
}
