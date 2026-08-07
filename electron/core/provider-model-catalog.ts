import { execFile } from 'node:child_process';

export type LocalProviderModel = { id: string; label: string; legacy?: boolean };
export type LocalProviderModelCatalog = { provider: 'codex' | 'claude'; version?: string; source: 'installed-cli'; models: LocalProviderModel[]; reason: string };
type CliCapability = { name: 'codex' | 'claude'; available: boolean; compatible?: boolean; executable?: string; version?: string };
type Runner = (file: string, args: string[]) => Promise<string>;
const run: Runner = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LANG: process.env.LANG, NO_COLOR: '1' } }, (error, stdout) => error ? reject(error) : resolve(stdout)));

export function parseCodexModelCatalog(raw: string): LocalProviderModel[] {
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).models) ? (parsed as Record<string, unknown>).models as unknown[] : [];
  const seen = new Set<string>(), result: LocalProviderModel[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>, id = String(row.slug ?? row.id ?? ''), label = String(row.display_name ?? row.name ?? id), visibility = String(row.visibility ?? 'list');
    if (visibility !== 'list' || !/^[A-Za-z0-9._:-]{1,100}$/.test(id) || !label || label.length > 120 || seen.has(id)) continue;
    seen.add(id); result.push({ id, label }); if (result.length >= 30) break;
  }
  return result;
}

export const CURATED_CODEX_MODELS: LocalProviderModel[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — flagship' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — balanced' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — fast' },
  { id: 'gpt-5.5', label: 'GPT-5.5 — previous generation' },
];

export const CURATED_CLAUDE_MODELS: LocalProviderModel[] = [
  { id: 'claude-fable-5', label: 'Claude Fable 5 — most capable' },
  { id: 'claude-opus-5', label: 'Claude Opus 5 — flagship' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
];

export async function installedCliModelCatalog(capabilities: CliCapability[], runner: Runner = run): Promise<LocalProviderModelCatalog[]> {
  const codex = capabilities.find((item) => item.name === 'codex'), claude = capabilities.find((item) => item.name === 'claude');
  let codexModels: LocalProviderModel[] = [], codexReason = 'Current Codex models bundled with this Waypoint release; the installed CLI did not report its account-scoped catalog.';
  if (codex?.available && codex.compatible !== false && codex.executable) try { codexModels = parseCodexModelCatalog(await runner(codex.executable, ['debug', 'models'])); if (codexModels.length) codexReason = 'Selectable models reported by this installed signed-in Codex CLI.'; } catch { /* curated fallback remains */ }
  if (!codexModels.length) codexModels = CURATED_CODEX_MODELS;
  return [
    { provider: 'codex', version: codex?.version, source: 'installed-cli', models: [{ id: '', label: 'Codex default (CLI selected)' }, ...codexModels], reason: codexReason },
    { provider: 'claude', version: claude?.version, source: 'installed-cli', models: [{ id: '', label: 'Claude default (CLI selected)' }, ...CURATED_CLAUDE_MODELS], reason: 'Current Claude models bundled with this Waypoint release; the default follows the signed-in Claude CLI configuration.' },
  ];
}
