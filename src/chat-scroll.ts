export const CHAT_FOLLOW_THRESHOLD = 96;

export function shouldFollowChat(scrollHeight: number, scrollTop: number, clientHeight: number) {
  return scrollHeight - scrollTop - clientHeight < CHAT_FOLLOW_THRESHOLD;
}
