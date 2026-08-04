import { describe, expect, it } from 'vitest';
import { shouldFollowChat } from './chat-scroll.js';

describe('chat auto follow', () => {
  it('follows streaming content near the bottom without fighting deliberate history scroll', () => {
    expect(shouldFollowChat(1000, 850, 100)).toBe(true);
    expect(shouldFollowChat(1000, 300, 100)).toBe(false);
    expect(shouldFollowChat(1000, 804, 100)).toBe(false);
    expect(shouldFollowChat(1000, 805, 100)).toBe(true);
  });
});
