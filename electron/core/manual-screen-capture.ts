import { createHash } from 'node:crypto'

export const CAPTURE_MODES = ['region', 'window', 'display'] as const
export const defaultCaptureShortcut=(platform:NodeJS.Platform)=>platform==='win32'?'PrintScreen':'CommandOrControl+Shift+8'
export const defaultCaptureWorkflow=(platform:NodeJS.Platform):CaptureWorkflow=>platform==='win32'?'quick':'guided'

export type CaptureMode = (typeof CAPTURE_MODES)[number]
export type CaptureWorkflow = 'guided' | 'quick'
export type CaptureTool =
  | 'select'
  | 'crop'
  | 'arrow'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'step'
  | 'highlight'
  | 'freehand'
  | 'blur'
  | 'pixelate'
  | 'redact'

export type CapturePoint = { x: number; y: number }
export type CaptureLayer = {
  id: string
  tool: CaptureTool
  x: number
  y: number
  width: number
  height: number
  color: string
  stroke: number
  text?: string
  points?: CapturePoint[]
}

export type CaptureSettings = {
  workflow: CaptureWorkflow
  mode: CaptureMode
  shortcut: string
  retentionDays: 7 | 30 | 90
  maxCaptures: number
}

const CAPTURE_MODIFIERS = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Option', 'AltGr', 'Shift', 'Super'])
const CAPTURE_KEYS = new Set([
  'PrintScreen', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Escape', 'Enter',
  'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack',
  'MediaStop', 'MediaPlayPause',
])

export function normalizeCaptureShortcut(value: string): string {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length || parts.length > 5) throw new Error('screen_capture_shortcut_invalid')
  const key = parts.at(-1)!
  const modifiers = parts.slice(0, -1)
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((part) => !CAPTURE_MODIFIERS.has(part))) {
    throw new Error('screen_capture_shortcut_invalid')
  }
  const normalizedKey = /^[a-z]$/i.test(key)
    ? key.toUpperCase()
    : /^\d$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key)
      ? key.toUpperCase()
      : CAPTURE_KEYS.has(key)
        ? key
        : undefined
  if (!normalizedKey || (!modifiers.length && normalizedKey !== 'PrintScreen' && !/^F\d+$/.test(normalizedKey))) {
    throw new Error('screen_capture_shortcut_invalid')
  }
  return [...modifiers, normalizedKey].join('+')
}

export function captureVisibilityStrategy(mode: CaptureMode): { hideWindow: boolean; hideOverlay: boolean } {
  return mode === 'window'
    ? { hideWindow: false, hideOverlay: true }
    : { hideWindow: true, hideOverlay: false }
}

const CAPTURE_TOOLS = new Set<CaptureTool>([
  'select', 'crop', 'arrow', 'line', 'rectangle', 'ellipse', 'text', 'step',
  'highlight', 'freehand', 'blur', 'pixelate', 'redact',
])

export function validateCaptureSettings(value: CaptureSettings): CaptureSettings {
  if (
    !['guided', 'quick'].includes(value.workflow)
    || !CAPTURE_MODES.includes(value.mode)
    || ![7, 30, 90].includes(value.retentionDays)
    || !Number.isSafeInteger(value.maxCaptures)
    || value.maxCaptures < 10
    || value.maxCaptures > 500
  ) throw new Error('screen_capture_settings_invalid')
  return { ...value, shortcut: normalizeCaptureShortcut(value.shortcut) }
}

export function quickCaptureCropBounds(
  selection: { x: number; y: number; width: number; height: number },
  displaySize: { width: number; height: number },
  imageSize: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (
    ![selection.x, selection.y, selection.width, selection.height, displaySize.width, displaySize.height, imageSize.width, imageSize.height].every(Number.isFinite)
    || selection.width < 4 || selection.height < 4
    || displaySize.width < 1 || displaySize.height < 1
    || imageSize.width < 1 || imageSize.height < 1
  ) throw new Error('screen_capture_region_invalid')
  const left = Math.max(0, Math.min(displaySize.width, selection.x)),
    top = Math.max(0, Math.min(displaySize.height, selection.y)),
    right = Math.max(left, Math.min(displaySize.width, selection.x + selection.width)),
    bottom = Math.max(top, Math.min(displaySize.height, selection.y + selection.height)),
    x = Math.min(imageSize.width - 1, Math.round(left * imageSize.width / displaySize.width)),
    y = Math.min(imageSize.height - 1, Math.round(top * imageSize.height / displaySize.height)),
    width = Math.max(1, Math.min(imageSize.width - x, Math.round((right - left) * imageSize.width / displaySize.width))),
    height = Math.max(1, Math.min(imageSize.height - y, Math.round((bottom - top) * imageSize.height / displaySize.height)))
  return { x, y, width, height }
}

function validatePoint(value: unknown, width: number, height: number): CapturePoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('screen_capture_layer_invalid')
  const point = value as Record<string, unknown>
  const x = Number(point.x)
  const y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) {
    throw new Error('screen_capture_layer_invalid')
  }
  return { x, y }
}

export function validateCaptureLayers(value: unknown, width: number, height: number): CaptureLayer[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('screen_capture_dimensions_invalid')
  }
  if (!Array.isArray(value) || value.length > 200) throw new Error('screen_capture_layers_invalid')
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('screen_capture_layer_invalid')
    const item = raw as Record<string, unknown>
    const tool = String(item.tool) as CaptureTool
    const x = Number(item.x)
    const y = Number(item.y)
    const layerWidth = Number(item.width)
    const layerHeight = Number(item.height)
    const stroke = Number(item.stroke)
    const color = String(item.color)
    const text = item.text === undefined ? undefined : String(item.text)
    if (
      !CAPTURE_TOOLS.has(tool)
      || ![x, y, layerWidth, layerHeight, stroke].every(Number.isFinite)
      || x < 0 || y < 0 || layerWidth < 0 || layerHeight < 0
      || x + layerWidth > width || y + layerHeight > height
      || stroke < 1 || stroke > 32
      || !/^#[0-9a-f]{6}$/i.test(color)
      || (text !== undefined && text.length > 500)
      || (item.points !== undefined && (!Array.isArray(item.points) || item.points.length > 2_000))
    ) throw new Error('screen_capture_layer_invalid')
    return {
      id: String(item.id).slice(0, 64),
      tool,
      x,
      y,
      width: layerWidth,
      height: layerHeight,
      color,
      stroke,
      ...(text ? { text } : {}),
      ...(Array.isArray(item.points)
        ? { points: item.points.map((point) => validatePoint(point, width, height)) }
        : {}),
    }
  })
}

export function captureDigest(bytes: Uint8Array): string {
  if (bytes.byteLength < 16 || bytes.byteLength > 50 * 1024 * 1024) throw new Error('screen_capture_bytes_invalid')
  return createHash('sha256').update(bytes).digest('hex')
}

export function assertVisibleCapturePixels(bitmap: Uint8Array, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || bitmap.byteLength !== width * height * 4) {
    throw new Error('screen_capture_pixel_buffer_invalid')
  }
  for (let offset = 0; offset < bitmap.byteLength; offset += 4) {
    // Electron nativeImage bitmaps are BGRA. Reject only the exact known
    // failure signature: every color channel is zero. One real non-black pixel
    // is sufficient, so legitimate nearly-black screenshots remain valid.
    if (bitmap[offset] !== 0 || bitmap[offset + 1] !== 0 || bitmap[offset + 2] !== 0) {
      return
    }
  }
  throw new Error('screen_capture_no_visible_pixels')
}

export function captureReadiness(
  platform: NodeJS.Platform,
  permission: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown',
  codeIdentity: 'stable' | 'version-specific' | 'unknown' = 'unknown',
) {
  if (platform === 'darwin') {
    const versionSpecific = codeIdentity === 'version-specific'
    const denied = permission === 'denied'
    const restricted = permission === 'restricted'
    return {
      platform: 'macOS',
      available: !denied && !restricted,
      permission,
      codeIdentity,
      state: permission === 'granted'
        ? 'ready'
        : denied && versionSpecific
          ? 'build_identity_changed'
          : restricted
            ? 'permission_restricted'
            : denied
              ? 'permission_denied'
              : 'permission_required',
      reason: permission === 'granted'
        ? `Ready. Waypoint captures only after you choose Capture.${versionSpecific ? ' This development build has a version-specific signature, so a later unsigned update can require permission again.' : ''}`
        : denied && versionSpecific
          ? 'This development build has a different macOS code identity than the Waypoint entry already enabled in System Settings. Open Screen Recording Settings, remove the stale Waypoint entry if necessary, add this installed Waypoint, then relaunch it. Consistently signed Apple builds preserve this permission after the one-time grant.'
          : restricted
            ? 'Screen Recording is restricted by macOS policy. Review Screen Recording in Privacy & Security or ask the device administrator, then relaunch Waypoint.'
            : denied
              ? 'Screen Recording is off for this installed Waypoint. Enable it in Privacy & Security, then quit and reopen Waypoint before retrying.'
              : 'macOS will request Screen Recording access only when you start a capture.',
    }
  }
  if (platform === 'win32') {
    return {
      platform: 'Windows',
      available: true,
      permission: 'picker',
      state: 'ready',
      reason: 'Guided capture opens Waypoint’s local source picker. Quick capture can grab a region, the active window, or the display under your cursor without opening Waypoint.',
    }
  }
  return {
    platform,
    available: false,
    permission: 'unsupported',
    state: 'platform_contingent',
    reason: 'Manual capture is currently packaged for macOS and Windows.',
  }
}

export function macCaptureCodeIdentity(
  designatedRequirement: string,
): 'stable' | 'version-specific' | 'unknown' {
  const requirement = designatedRequirement.trim()
  if (!requirement.includes('designated =>')) return 'unknown'
  if (/\bcdhash\b/i.test(requirement)) return 'version-specific'
  return /\bidentifier\b/i.test(requirement) ? 'stable' : 'unknown'
}
