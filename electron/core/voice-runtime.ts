import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_VOICE_AUDIO_BYTES = 32 * 1024 * 1024;
export type VoiceRuntimeConfig = { version: 1; binaryPath: string; modelPath: string; configuredAt: string };
export type BundledVoiceRuntime = { binaryPath: string; modelPath: string; frameworkPath: string; binarySha256: string; modelSha256: string; frameworkSha256: string; label: string };
export type VoiceCapability = { stt: { available: boolean; provider: 'whisper.cpp'; reason: string; source?: 'bundled' | 'legacy-custom'; model?: string; binaryPath?: string; modelPath?: string }; tts: { available: boolean; provider: 'macos-say' | 'unavailable'; reason: string }; rawAudioPersistence: false; cloudSpeech: false };
type Runner = (file: string, args: string[], options: { timeout: number; maxBuffer: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: Runner = (file, args, options) => new Promise((resolve, reject) => execFile(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer, signal: options.signal, encoding: 'utf8' }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
function regular(pathname: string) { const stat = lstatSync(pathname); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('voice_runtime_path_invalid'); return stat; }
function digest(pathname: string) { return createHash('sha256').update(readFileSync(pathname)).digest('hex'); }

function supportedMacVersion(version:string){const [major=0,minor=0]=version.split('.').map(Number);return major>13||major===13&&minor>=3}
export class VoiceRuntimeRegistry {
  private readonly ephemeralRoot: string;
  private bundledChecked = false;
  private bundledError?: string;

  constructor(private readonly configPath: string, private readonly platform = process.platform, private readonly runner: Runner = defaultRunner, private readonly bundled?: BundledVoiceRuntime, private readonly architecture = process.arch,private readonly systemVersion='99.0') {
    this.ephemeralRoot = path.join(path.dirname(configPath), 'voice-ephemeral');
    rmSync(this.ephemeralRoot, { recursive: true, force: true });
    mkdirSync(this.ephemeralRoot, { recursive: true, mode: 0o700 });
  }

  async configure(binaryPath: string, modelPath: string) {
    binaryPath = path.resolve(binaryPath); modelPath = path.resolve(modelPath);
    accessSync(binaryPath, constants.R_OK | constants.X_OK); accessSync(modelPath, constants.R_OK);
    regular(binaryPath); const model = regular(modelPath);
    if (model.size < 1024 || model.size > 20 * 1024 * 1024 * 1024) throw new Error('voice_model_size_invalid');
    const probe = await this.runner(binaryPath, ['--help'], { timeout: 5_000, maxBuffer: 256 * 1024 });
    if (!/whisper/i.test(`${probe.stdout}\n${probe.stderr}`)) throw new Error('voice_runtime_incompatible');
    const value: VoiceRuntimeConfig = { version: 1, binaryPath, modelPath, configuredAt: new Date().toISOString() }, temporary = `${this.configPath}.${randomUUID()}.partial`;
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(temporary, this.configPath);
    return this.capability();
  }

  remove() { rmSync(this.configPath, { force: true }); return this.capability(); }
  load(): VoiceRuntimeConfig | undefined { try { const parsed = JSON.parse(readFileSync(this.configPath, 'utf8')) as VoiceRuntimeConfig; return parsed.version === 1 && typeof parsed.binaryPath === 'string' && typeof parsed.modelPath === 'string' ? parsed : undefined; } catch { return undefined; } }

  private bundledRuntime(): { binaryPath: string; modelPath: string; source: 'bundled'; model: string } | undefined {
    if (!this.bundled || this.platform !== 'darwin' || this.architecture !== 'arm64'||!supportedMacVersion(this.systemVersion)) return undefined;
    if (!this.bundledChecked) {
      this.bundledChecked = true;
      try {
        accessSync(this.bundled.binaryPath, constants.R_OK | constants.X_OK); accessSync(this.bundled.modelPath, constants.R_OK); accessSync(this.bundled.frameworkPath, constants.R_OK);
        regular(this.bundled.binaryPath); regular(this.bundled.modelPath); regular(this.bundled.frameworkPath);
        if (digest(this.bundled.binaryPath) !== this.bundled.binarySha256 || digest(this.bundled.modelPath) !== this.bundled.modelSha256 || digest(this.bundled.frameworkPath) !== this.bundled.frameworkSha256) throw new Error('integrity');
      } catch { this.bundledError = 'The bundled local speech files failed their integrity check. Reinstall this Waypoint build.'; }
    }
    return this.bundledError ? undefined : { binaryPath: this.bundled.binaryPath, modelPath: this.bundled.modelPath, source: 'bundled', model: this.bundled.label };
  }

  private selectedRuntime() {
    const bundled = this.bundledRuntime(); if (bundled) return bundled;
    const config = this.load(); if (!config) return undefined;
    try { accessSync(config.binaryPath, constants.R_OK | constants.X_OK); accessSync(config.modelPath, constants.R_OK); regular(config.binaryPath); regular(config.modelPath); return { binaryPath: config.binaryPath, modelPath: config.modelPath, source: 'legacy-custom' as const, model: path.basename(config.modelPath) }; } catch { return undefined; }
  }

  capability(): VoiceCapability {
    const runtime = this.selectedRuntime(), reason = runtime?.source === 'bundled' ? `Offline English transcription is ready with bundled ${runtime.model}.` : runtime ? 'A legacy custom local speech runtime is available. Reinstall Waypoint to restore the bundled default.' : this.bundledError ?? (this.platform === 'darwin'&&this.architecture==='arm64'&&!supportedMacVersion(this.systemVersion)?'Bundled local speech requires macOS 13.3 or later.':this.platform === 'darwin' && this.architecture === 'arm64' ? 'Bundled local speech is missing. Reinstall this Waypoint build.' : 'Bundled local speech is not yet available for this platform.');
    return { stt: { available: Boolean(runtime), provider: 'whisper.cpp', reason, ...(runtime ? { source: runtime.source, model: runtime.model, binaryPath: runtime.binaryPath, modelPath: runtime.modelPath } : {}) }, tts: this.platform === 'darwin' ? { available: true, provider: 'macos-say', reason: 'Uses the local macOS system voice.' } : { available: false, provider: 'unavailable', reason: 'Local speech playback is not yet reviewed for this platform.' }, rawAudioPersistence: false, cloudSpeech: false };
  }

  async transcribe(wav: Uint8Array, signal?: AbortSignal) {
    if (!wav.byteLength || wav.byteLength > MAX_VOICE_AUDIO_BYTES) throw new Error('voice_audio_size_invalid');
    if (signal?.aborted) throw new Error('voice_canceled');
    const runtime = this.selectedRuntime(); if (!runtime) throw new Error('voice_stt_unavailable');
    const root = mkdtempSync(path.join(this.ephemeralRoot, 'turn-')), audio = path.join(root, 'turn.wav'), output = path.join(root, 'transcript');
    try {
      writeFileSync(audio, wav, { flag: 'wx', mode: 0o600 });
      await this.runner(runtime.binaryPath, ['-m', runtime.modelPath, '-f', audio, '-otxt', '-of', output, '-nt'], { timeout: 120_000, maxBuffer: 1024 * 1024, signal });
      if (signal?.aborted) throw new Error('voice_canceled');
      const text = readFileSync(`${output}.txt`, 'utf8').trim(); if (!text || text.length > 200_000) throw new Error('voice_transcript_invalid');
      return { text, provider: 'whisper.cpp' as const, modelPath: runtime.modelPath };
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
}

export class NativeSpeechAdapter {
  private child?: ChildProcess; private sequence = 0;
  constructor(private readonly platform = process.platform, private readonly launch = spawn) {}
  available() { return this.platform === 'darwin'; }
  speak(text: string, onDone: (result: 'completed' | 'canceled' | 'failed') => void) { if (!this.available()) throw new Error('voice_tts_unavailable'); if (!text.trim() || text.length > 200_000) throw new Error('voice_tts_text_invalid'); this.stop(); const sequence = ++this.sequence, child = this.launch('/usr/bin/say', ['--', text], { stdio: 'ignore' }); this.child = child; child.once('error', () => { if (sequence === this.sequence) { this.child = undefined; onDone('failed'); } }); child.once('exit', (code, signal) => { if (sequence !== this.sequence) return; this.child = undefined; onDone(signal ? 'canceled' : code === 0 ? 'completed' : 'failed'); }); return () => this.stop(); }
  stop() { this.sequence++; const child = this.child; this.child = undefined; if (child && !child.killed) child.kill('SIGTERM'); }
}
