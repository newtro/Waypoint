import { createHash } from 'node:crypto'

export const CAPTURE_MODES = ['region', 'window', 'display'] as const
export const CAPTURE_SHORTCUTS = [
  'PrintScreen',
  'CommandOrControl+Shift+8',
  'CommandOrControl+Shift+9',
  'CommandOrControl+Alt+8',
] as const
export const defaultCaptureShortcut=(platform:NodeJS.Platform)=>platform==='win32'?'PrintScreen':'CommandOrControl+Shift+8'

export type CaptureMode = (typeof CAPTURE_MODES)[number]
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
  mode: CaptureMode
  shortcut: string
  retentionDays: 7 | 30 | 90
  maxCaptures: number
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
    !CAPTURE_MODES.includes(value.mode)
    || !CAPTURE_SHORTCUTS.includes(value.shortcut as (typeof CAPTURE_SHORTCUTS)[number])
    || ![7, 30, 90].includes(value.retentionDays)
    || !Number.isSafeInteger(value.maxCaptures)
    || value.maxCaptures < 10
    || value.maxCaptures > 500
  ) throw new Error('screen_capture_settings_invalid')
  return value
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
) {
  if (platform === 'darwin') {
    return {
      platform: 'macOS',
      available: permission !== 'denied' && permission !== 'restricted',
      permission,
      state: permission === 'granted' ? 'ready' : 'permission_required',
      reason: permission === 'granted'
        ? 'Ready. Waypoint captures only after you choose Capture.'
        : 'macOS will request Screen Recording access only when you start a capture.',
    }
  }
  if (platform === 'win32') {
    return {
      platform: 'Windows',
      available: true,
      permission: 'picker',
      state: 'ready',
      reason: 'Waypoint uses Electron’s Windows desktop-capture backend and asks you to choose a window or display in its local capture sheet.',
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
