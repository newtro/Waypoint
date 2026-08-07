import { describe, expect, it } from 'vitest'
import {
  captureDigest,
  captureReadiness,
  defaultCaptureShortcut,
  validateCaptureLayers,
  validateCaptureSettings,
} from './manual-screen-capture.js'

describe('manual screen capture boundary', () => {
  it('accepts only curated bounded settings', () => {
    expect(validateCaptureSettings({
      mode: 'region',
      shortcut: 'CommandOrControl+Shift+8',
      retentionDays: 30,
      maxCaptures: 100,
    })).toMatchObject({ mode: 'region' })
    expect(() => validateCaptureSettings({
      mode: 'display',
      shortcut: 'Control+X',
      retentionDays: 30,
      maxCaptures: 100,
    })).toThrow(/invalid/)
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
    expect(defaultCaptureShortcut('win32')).toBe('PrintScreen')
    expect(defaultCaptureShortcut('darwin')).toBe('CommandOrControl+Shift+8')
  })
})
