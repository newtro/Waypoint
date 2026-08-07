export type AutoTitleLane = "claude" | "openrouter" | "local";
export type AutoTitleResult = { title: string; lane: AutoTitleLane; model: string; reason: string };
export const PRIVATE_TITLE_SEED="Private conversation";

export function localChatTitle(message: string): string {
  const clean = message.replace(/[()`*_#>{}]/g, " ").replaceAll("[", " ").replaceAll("]", " ").replace(/\bhttps?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  const words = clean.split(" ").slice(0, 8);
  const title = words.join(" ").replace(/[.,;:!?-]+$/g, "");
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
}

export function normalizeGeneratedTitle(value: string): string | undefined {
  if (/\r|\n/.test(value)) return undefined;
  const title = value.replace(/^[\s"'`#*-]+|[\s"'`#*-]+$/g, "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title;
}

export function privacySafeTitleSeed(user: string): string {
  const sensitive=/```|\b(?:password|passcode|secret|authorization|cookie|bearer|api[-_ ]?key|token|client[-_ ]?secret)\b|\bAKIA[A-Z0-9]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:^|\s)(?:[A-Za-z]:\\|\/(?:Users|home|private|var|etc)\/)|["'][^"'\n]{4,}["']/i;
  if(sensitive.test(user))return PRIVATE_TITLE_SEED;
  return user.replace(/\b(?:tool|command|stdout|stderr|attachment)\s*:.*/gi,"[output omitted]").replace(/\bhttps?:\/\/\S+/gi,"[link omitted]").replace(/\b[A-Za-z0-9_-]{32,}\b/g,"[sensitive value omitted]").replace(/\s+/g," ").trim().slice(0, 320);
}

export function minimalTitlePrompt(user: string): string {
  return `Create a concise 3-7 word title for this chat. Return only the title, with no quotes or punctuation suffix. Do not use tools.\nUser topic: ${privacySafeTitleSeed(user)}`;
}

export async function resolveAutomaticTitle(input:{user:string;signal:AbortSignal;claude?:()=>Promise<{text:string;model:string}>;openrouter?:()=>Promise<{text:string;model:string}>;observe?:(lane:AutoTitleLane,outcome:'selected'|'failed'|'unavailable')=>void}):Promise<AutoTitleResult>{
  const safeSeed=privacySafeTitleSeed(input.user);if(safeSeed===PRIVATE_TITLE_SEED){input.observe?.('claude','unavailable');input.observe?.('openrouter','unavailable');input.observe?.('local','selected');return{title:PRIVATE_TITLE_SEED,lane:'local',model:'deterministic-v1',reason:'Sensitive topic markers kept the title fully local and generic'}}
  if(input.claude&&!input.signal.aborted)try{const value=await input.claude(),title=normalizeGeneratedTitle(value.text);if(title){input.observe?.('claude','selected');return{title,lane:'claude',model:value.model,reason:'Installed Claude Code lightweight lane'}}input.observe?.('claude','failed')}catch{input.observe?.('claude','failed')}
  else input.observe?.('claude','unavailable');
  if(input.openrouter&&!input.signal.aborted)try{const value=await input.openrouter(),title=normalizeGeneratedTitle(value.text);if(title){input.observe?.('openrouter','selected');return{title,lane:'openrouter',model:value.model,reason:'Configured low-cost OpenRouter title lane'}}input.observe?.('openrouter','failed')}catch{input.observe?.('openrouter','failed')}
  else input.observe?.('openrouter','unavailable');
  input.observe?.('local','selected');
  return{title:localChatTitle(safeSeed),lane:'local',model:'deterministic-v1',reason:input.signal.aborted?'Title request canceled; deterministic local fallback selected':'Provider unavailable, failed, or spending-capped'}
}

export function autoTitleMayStart(stopped:boolean):boolean{return !stopped}
