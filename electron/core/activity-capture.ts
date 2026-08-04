import { createHash } from 'node:crypto';

export const ACTIVITY_CAPTURE_POLICY_VERSION = 1;
export const ACTIVITY_RETENTION_DAYS = [90, 183, 365] as const;
export const MAX_ACTIVITY_FRAME_BYTES = 25 * 1024 * 1024;
export const MAX_ACTIVITY_QUERY = 100;
const SENSITIVE_BUNDLES = new Set(['com.apple.loginwindow', 'com.apple.systempreferences.passwords', 'com.1password.1password', 'com.bitwarden.desktop']);
const ID = /^[A-Za-z0-9._-]{1,200}$/;

export type ActivityCapturePolicy = {
  version: 1;
  enabled: boolean;
  paused: boolean;
  retentionDays: 90 | 183 | 365;
  syncRaw: boolean;
  exclusions: string[];
};
export type ActivityFrameContext = {
  capturedAt: string;
  deviceId: string;
  displayId: string;
  appBundleId: string;
  appProcess: string;
  appTitle?: string;
  locked: boolean;
  sleeping: boolean;
  diskAvailableBytes: number;
  identityAfterCapture?: string;
};

export function defaultActivityCapturePolicy(): ActivityCapturePolicy {
  return { version: 1, enabled: false, paused: true, retentionDays: 90, syncRaw: false, exclusions: [] };
}

export function validateActivityCapturePolicy(value: unknown): ActivityCapturePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('activity_policy_invalid');
  const policy = value as Record<string, unknown>;
  if (policy.version !== 1 || typeof policy.enabled !== 'boolean' || typeof policy.paused !== 'boolean' || typeof policy.syncRaw !== 'boolean' || !ACTIVITY_RETENTION_DAYS.includes(policy.retentionDays as never) || !Array.isArray(policy.exclusions) || policy.exclusions.length > 100) throw new Error('activity_policy_invalid');
  const exclusions = policy.exclusions.map((item) => String(item).trim().toLowerCase());
  if (new Set(exclusions).size !== exclusions.length || exclusions.some((item) => !ID.test(item))) throw new Error('activity_exclusions_invalid');
  return { version: 1, enabled: policy.enabled, paused: policy.enabled ? policy.paused : true, retentionDays: policy.retentionDays as 90 | 183 | 365, syncRaw: policy.syncRaw, exclusions };
}

export function captureDecision(policy: ActivityCapturePolicy, context: ActivityFrameContext, bytes: Uint8Array, nowMs = Date.now()): { accepted: true; sha256: string; expiresAt: string } | { accepted: false; reason: string } {
  validateActivityCapturePolicy(policy);
  if (!policy.enabled || policy.paused) return { accepted: false, reason: 'paused' };
  if (context.locked || context.sleeping) return { accepted: false, reason: context.locked ? 'device_locked' : 'device_sleeping' };
  const bundle = context.appBundleId.trim().toLowerCase(), process = context.appProcess.trim().toLowerCase();
  if (!ID.test(bundle) || !ID.test(process) || !ID.test(context.deviceId) || !ID.test(context.displayId)) return { accepted: false, reason: 'context_invalid' };
  if (SENSITIVE_BUNDLES.has(bundle) || policy.exclusions.includes(bundle) || policy.exclusions.includes(process)) return { accepted: false, reason: 'app_excluded' };
  if (context.identityAfterCapture && context.identityAfterCapture.trim().toLowerCase() !== bundle) return { accepted: false, reason: 'app_changed' };
  if (!Number.isSafeInteger(context.diskAvailableBytes) || context.diskAvailableBytes < Math.max(512 * 1024 * 1024, bytes.byteLength * 4)) return { accepted: false, reason: 'low_disk' };
  if (!bytes.byteLength || bytes.byteLength > MAX_ACTIVITY_FRAME_BYTES) return { accepted: false, reason: 'frame_invalid' };
  const captured = Date.parse(context.capturedAt);
  if (!Number.isFinite(captured) || Math.abs(captured - nowMs) > 5 * 60_000) return { accepted: false, reason: 'timestamp_invalid' };
  return { accepted: true, sha256: createHash('sha256').update(bytes).digest('hex'), expiresAt: new Date(captured + policy.retentionDays * 86_400_000).toISOString() };
}

export function macActivityCaptureReadiness(platform = process.platform): { available: false; state: string; reason: string; permissionRequired: boolean } {
  return platform === 'darwin'
    ? { available: false, state: 'consent_required', reason: 'Native snapshot capture is packaged as a readiness seam. Waypoint will not request Screen Recording permission or capture until you explicitly start a later live test.', permissionRequired: true }
    : { available: false, state: 'platform_contingent', reason: 'Native whole-device capture is not yet verified on this platform.', permissionRequired: true };
}
