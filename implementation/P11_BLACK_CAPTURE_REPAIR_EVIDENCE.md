# P11 black capture regression repair — evidence

Status: complete on 2026-08-07; final independent re-review 0 blocker / 0 high / 1 medium.

## Reproduction and cause

The normal-profile database retained the reported failure exactly: a 7568×4320 PNG, `mode=window`, `source=Waypoint`, whose decoded pixels were uniformly black. Storage, Ready preview, and editor were not corrupting the image; they faithfully displayed the black PNG received from Electron.

The cause was the source-recapture sequence. Waypoint hid its entire BrowserWindow before recapturing every source. When the selected source was the Waypoint window itself, Electron therefore recaptured a hidden window and returned a black frame. The prior successful display test did not exercise this window-source path.

## Repair

- Window capture keeps the selected window visible and temporarily hides only Waypoint's capture overlay. A sender-bound token is acknowledged after two renderer animation frames before recapture; restoration is best-effort in an outer `finally`, including timeout/error. Display/region capture retains the whole-window hide behavior so Waypoint does not appear in a display capture.
- Final recapture uses the bounded dimensions already proven by source enumeration rather than requesting a second oversized 7680×4320 thumbnail.
- The trusted main process scans the complete BGRA bitmap before PNG serialization and rejects only the known exact no-visible-pixels signature: every RGB channel is zero. It does not use average brightness, so a genuinely dark image with even one non-black pixel remains valid.
- A rejected frame is never persisted and returns an actionable Screen Recording/visibility/retry message.

## Real packaged evidence

The final macOS arm64 normal-profile package repeated the exact `Window → Waypoint` route. The Ready state showed visible Waypoint UI at 3780×2160. The image was opened in the editor, flattened and saved, the editor was closed, and capture `7a1928b3-f2c3-460c-bd66-463bb4665649` was reopened from history at 3780×2160. Its persisted PNG remained visibly populated through that path.

Focused validation is 15/15 and covers all-black rejection, a lone nonzero final pixel, invalid bitmap length, visibility policy, exact persisted/flattened byte round-trip, capture lifecycle, and capture UI. The full gate is 117 suites / 516 tests, TypeScript/Vite build clean, lint 0 errors (nine pre-existing warnings), and macOS arm64 package closure. macOS Screen Recording permission was already granted for the user-triggered path; no consent was bypassed. Validation used the workspace-bundled Node 24.14 with npm `--force` because this checkout declares Node 24.15/npm 12 while those exact versions were not locally installed; all commands themselves completed.

The fresh reviewer found the initial overlay timing and sampled-pixel checks high severity. Both were repaired and re-reviewed. Final verdict is 0 blocker / 0 high / 1 medium: the remaining non-gating debt is that the store byte round-trip fixture has intentionally mismatched pre-flatten metadata and verifies exact bytes rather than decoding pixel color; exact native-bitmap tests plus the decoded real packaged capture cover the user-facing acceptance path.
