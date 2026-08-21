import { describe, expect, it } from 'vitest'
import {
  captureDigest,
  captureReadiness,
  macCaptureCodeIdentity,
  assertVisibleCapturePixels,
  captureVisibilityStrategy,
  defaultCaptureWorkflow,
  defaultCaptureShortcut,
  normalizeCaptureShortcut,
  quickCaptureCropBounds,
  validateCaptureLayers,
  validateCaptureSettings,
} from './manual-screen-capture.js'

describe('manual screen capture boundary', () => {
  it('accepts bounded settings and safe user-recorded accelerators', () => {
    expect(validateCaptureSettings({
      workflow: 'quick',
      mode: 'region',
      shortcut: 'CommandOrControl+Shift+k',
      retentionDays: 30,
      maxCaptures: 100,
    })).toMatchObject({ workflow: 'quick', mode: 'region', shortcut: 'CommandOrControl+Shift+K' })
    expect(() => validateCaptureSettings({
      workflow: 'guided',
      mode: 'display',
      shortcut: 'Control+NotAKey',
      retentionDays: 30,
      maxCaptures: 100,
    })).toThrow(/invalid/)
    expect(normalizeCaptureShortcut('PrintScreen')).toBe('PrintScreen')
    expect(() => normalizeCaptureShortcut('X')).toThrow(/invalid/)
  })

  it('bounds editable layers and irreversible tools', () => {
    expect(validateCaptureLayers([{
      id: 'r',
      tool: 'redact',
      x: 1,
      y: 2,
      width: 20,
      height: 10,
      color: '#111111',
      stroke: 4,
    }], 100, 100)[0].tool).toBe('redact')
    expect(() => validateCaptureLayers([{
      id: 'x',
      tool: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 1,
      color: '#000000',
      stroke: 1,
    }], 100, 100)).toThrow(/invalid/)
  })

  it('validates freehand points and rejects coordinates outside the capture', () => {
    expect(() => validateCaptureLayers([{
      id: 'f', tool: 'freehand', x: 0, y: 0, width: 10, height: 10,
      color: '#000000', stroke: 2, points: [{ x: 101, y: 5 }],
    }], 100, 100)).toThrow(/invalid/)
  })

  it('validates bytes and truthful platform readiness', () => {
    expect(captureDigest(new Uint8Array(16))).toHaveLength(64)
    expect(captureReadiness('darwin', 'not-determined')).toMatchObject({ available: true, state: 'permission_required' })
    expect(captureReadiness('win32', 'unknown')).toMatchObject({ available: true, permission: 'picker' })
    expect(captureReadiness('linux', 'unknown').available).toBe(false)
    expect(captureReadiness('darwin', 'denied', 'stable')).toMatchObject({
      available: false,
      state: 'permission_denied',
      reason: expect.stringMatching(/Enable it.*quit and reopen/),
    })
    expect(captureReadiness('darwin', 'restricted', 'stable')).toMatchObject({
      available: false,
      state: 'permission_restricted',
      reason: expect.stringMatching(/restricted.*administrator/),
    })
    expect(defaultCaptureShortcut('win32')).toBe('PrintScreen')
    expect(defaultCaptureShortcut('darwin')).toBe('CommandOrControl+Shift+8')
    expect(defaultCaptureWorkflow('win32')).toBe('quick')
    expect(defaultCaptureWorkflow('darwin')).toBe('guided')
  })

  it('distinguishes stable signed builds from version-specific ad-hoc privacy identities', () => {
    expect(macCaptureCodeIdentity('# designated => cdhash H"abc"')).toBe('version-specific')
    expect(macCaptureCodeIdentity('# designated => identifier "com.waypoint.desktop" and anchor rootCert')).toBe('stable')
    expect(macCaptureCodeIdentity('unsigned')).toBe('unknown')
    expect(captureReadiness('darwin', 'denied', 'version-specific')).toMatchObject({
      state: 'build_identity_changed',
      codeIdentity: 'version-specific',
    })
  })

  it('maps a dragged region from display coordinates to native image pixels', () => {
    expect(quickCaptureCropBounds(
      { x: 100, y: 50, width: 400, height: 300 },
      { width: 1000, height: 500 },
      { width: 2000, height: 1000 },
    )).toEqual({ x: 200, y: 100, width: 800, height: 600 })
    expect(quickCaptureCropBounds(
      { x: -10, y: -10, width: 40, height: 40 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    )).toEqual({ x: 0, y: 0, width: 30, height: 30 })
    expect(() => quickCaptureCropBounds({ x: 0, y: 0, width: 2, height: 2 }, { width: 100, height: 100 }, { width: 100, height: 100 })).toThrow(/invalid/)
  })

  it('rejects the exact all-black native frame signature without rejecting dark content', () => {
    expect(() => assertVisibleCapturePixels(new Uint8Array(4 * 4 * 4), 4, 4)).toThrow('screen_capture_no_visible_pixels')
    const dark = new Uint8Array(4 * 4 * 4)
    dark[dark.byteLength - 2] = 1
    expect(() => assertVisibleCapturePixels(dark, 4, 4)).not.toThrow()
    expect(() => assertVisibleCapturePixels(new Uint8Array(12), 4, 4)).toThrow('screen_capture_pixel_buffer_invalid')
  })

  it('keeps a selected window capturable while removing only the Waypoint overlay', () => {
    expect(captureVisibilityStrategy('window')).toEqual({ hideWindow: false, hideOverlay: true })
    expect(captureVisibilityStrategy('region')).toEqual({ hideWindow: true, hideOverlay: false })
    expect(captureVisibilityStrategy('display')).toEqual({ hideWindow: true, hideOverlay: false })
  })
})
