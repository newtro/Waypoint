import { useEffect, useRef, useState } from 'react'

function acceleratorKey(event: React.KeyboardEvent): string | undefined {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5)
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key)) return event.key
  if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase()
  const shiftedDigit = ')!@#$%^&*('.indexOf(event.key)
  if (shiftedDigit >= 0) return String(shiftedDigit)
  return ({
    ' ': 'Space',
    PrintScreen: 'PrintScreen',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Home: 'Home',
    End: 'End',
    Insert: 'Insert',
    Delete: 'Delete',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Enter: 'Enter',
  } as Record<string, string>)[event.key]
}

function formatAccelerator(value: string, platform: string): string {
  return value
    .replace('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl')
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Option', 'Alt')
    .replaceAll('+', ' + ')
    .replace('PrintScreen', 'Print Screen')
}

export function HotkeyRecorder({
  workspaceId,
  value,
  platform,
  onChange,
}: {
  workspaceId: string
  value: string
  platform: string
  onChange: (value: string) => void
}) {
  const [recording, setRecording] = useState(false), active = useRef(false)
  const finish = async () => {
    if (!active.current) return
    active.current = false
    setRecording(false)
    await window.waypoint.setScreenCaptureShortcutRecording(workspaceId, false).catch(() => undefined)
  }
  useEffect(() => () => { if (active.current) void window.waypoint.setScreenCaptureShortcutRecording(workspaceId, false) }, [workspaceId])
  async function start() {
    if (active.current) return
    await window.waypoint.setScreenCaptureShortcutRecording(workspaceId, true)
    active.current = true
    setRecording(true)
  }
  async function keyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { await finish(); return }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    const key = acceleratorKey(event)
    if (!key) return
    const modifiers = [
      ...(event.ctrlKey ? [platform === 'darwin' ? 'Control' : 'CommandOrControl'] : []),
      ...(event.metaKey ? [platform === 'darwin' ? 'Command' : 'Super'] : []),
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey ? ['Shift'] : []),
    ]
    if (!modifiers.length && key !== 'PrintScreen' && !/^F\d+$/.test(key)) return
    onChange([...modifiers, key].join('+'))
    await finish()
  }
  return <div className="hotkey-recorder">
    <button
      type="button"
      className={recording ? 'recording' : ''}
      aria-label="Record global screen capture shortcut"
      aria-pressed={recording}
      onClick={() => void start()}
      onKeyDown={(event) => void keyDown(event)}
      onBlur={() => void finish()}
    >
      <span>{recording ? 'Press your shortcut…' : formatAccelerator(value, platform)}</span>
      <small>{recording ? 'Esc cancels' : 'Click to record'}</small>
    </button>
    <button type="button" onClick={() => onChange(platform === 'win32' ? 'PrintScreen' : 'CommandOrControl+Shift+8')}>
      Reset default
    </button>
  </div>
}
