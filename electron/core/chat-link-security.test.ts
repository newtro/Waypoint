import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('assistant external links', () => {
  it('uses the trusted main-process bridge with a narrow protocol policy', () => {
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8'), preload = readFileSync(new URL('../preload.ts', import.meta.url), 'utf8');
    expect(main).toContain("['https:','http:','mailto:'].includes(url.protocol)");
    expect(main).toContain('url.username||url.password');
    expect(main).toContain('shell.openExternal(url.href)');
    expect(preload).toContain("openExternal:(url:string)=>ipcRenderer.invoke('waypoint:open-external',{url})");
  });
});
