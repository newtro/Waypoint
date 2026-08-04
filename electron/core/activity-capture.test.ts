import { describe, expect, it } from 'vitest';
import { captureDecision, defaultActivityCapturePolicy, macActivityCaptureReadiness, validateActivityCapturePolicy } from './activity-capture.js';

const context = (overrides: Record<string, unknown> = {}) => ({ capturedAt: new Date(0).toISOString(), deviceId: 'mac-a', displayId: 'display-1', appBundleId: 'com.example.editor', appProcess: 'editor', locked: false, sleeping: false, diskAvailableBytes: 1024 ** 3, ...overrides });
describe('activity capture privacy policy', () => {
  it('defaults off and restart-safe paused', () => expect(defaultActivityCapturePolicy()).toMatchObject({ enabled: false, paused: true, syncRaw: false, retentionDays: 90 }));
  it('rejects capture while paused, locked, sleeping, excluded, sensitive, changed, low disk, malformed, or stale', () => {
    const policy = { ...defaultActivityCapturePolicy(), enabled: true, paused: false, exclusions: ['com.example.private'] }, frame = new Uint8Array([1, 2, 3]);
    expect(captureDecision({ ...policy, paused: true }, context(), frame, 0)).toMatchObject({ reason: 'paused' });
    expect(captureDecision(policy, context({ locked: true }), frame, 0)).toMatchObject({ reason: 'device_locked' });
    expect(captureDecision(policy, context({ sleeping: true }), frame, 0)).toMatchObject({ reason: 'device_sleeping' });
    expect(captureDecision(policy, context({ appBundleId: 'com.example.private' }), frame, 0)).toMatchObject({ reason: 'app_excluded' });
    expect(captureDecision(policy, context({ appBundleId: 'com.1password.1password' }), frame, 0)).toMatchObject({ reason: 'app_excluded' });
    expect(captureDecision(policy, context({ identityAfterCapture: 'com.other.app' }), frame, 0)).toMatchObject({ reason: 'app_changed' });
    expect(captureDecision(policy, context({ diskAvailableBytes: 100 }), frame, 0)).toMatchObject({ reason: 'low_disk' });
    expect(captureDecision(policy, context(), new Uint8Array(), 0)).toMatchObject({ reason: 'frame_invalid' });
    expect(captureDecision(policy, context({ capturedAt: new Date(-600_001).toISOString() }), frame, 0)).toMatchObject({ reason: 'timestamp_invalid' });
  });
  it('uses UTC-day retention and validates bounded exclusions', () => {
    const policy = validateActivityCapturePolicy({ version: 1, enabled: true, paused: false, syncRaw: true, retentionDays: 365, exclusions: ['Com.Example.Private'] });
    expect(captureDecision(policy, context(), new Uint8Array([1]), 0)).toMatchObject({ accepted: true, expiresAt: '1971-01-01T00:00:00.000Z' });
    expect(policy.exclusions).toEqual(['com.example.private']);
  });
  it('never claims live native readiness', () => expect(macActivityCaptureReadiness('darwin')).toMatchObject({ available: false, state: 'consent_required', permissionRequired: true }));
});
