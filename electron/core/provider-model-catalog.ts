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

export async function installedCliModelCatalog(capabilities: CliCapability[], runner: Runner = run): Promise<LocalProviderModelCatalog[]> {
  const codex = capabilities.find((item) => item.name === 'codex'), claude = capabilities.find((item) => item.name === 'claude');
  let codexModels: LocalProviderModel[] = [], codexReason = 'Use the signed-in Codex CLI default. Its account-scoped model catalog is unavailable.';
  if (codex?.available && codex.compatible !== false && codex.executable) try { codexModels = parseCodexModelCatalog(await runner(codex.executable, ['debug', 'models'])); if (codexModels.length) codexReason = 'Selectable models reported by this installed signed-in Codex CLI.'; } catch { /* default remains truthful */ }
  return [
    { provider: 'codex', version: codex?.version, source: 'installed-cli', models: [{ id: '', label: 'Codex default (CLI selected)' }, ...codexModels], reason: codexReason },
    { provider: 'claude', version: claude?.version, source: 'installed-cli', models: [{ id: '', label: 'Claude default (CLI selected)' }], reason: 'Claude Code exposes a selectable default locally but no account-scoped model catalog without a live request; Waypoint does not guess aliases.' },
  ];
}
