# Screen Capture Add-to-Chat repair evidence

Status: clean; ready to commit.

## Delivered

- Screenshot Ready and capture history attach directly to the active chat and update the composer immediately; success is the visible attachment, not a persistent notice.
- Capture and pasted-image previews are bounded main-process derivatives with dimension, pixel, signature, digest, and decoder validation before persistence or decode.
- Composer and persisted messages show accessible image thumbnails with safe full-image viewing, corrupt/missing states, multiple-image handling, removal, context clearing, focus containment, and focus restoration.
- Add/paste operations revalidate workspace/chat identity around asynchronous work, use attempt-aware busy state, roll back partial writes, surface cleanup failures, and avoid duplicate queued copies while allowing a capture to be re-added after sending.
- Schema 38 restores only untouched Windows preferences silently auto-flipped by schema 34; later explicit Quick choices remain unchanged.
- ESLint is enforced with `--max-warnings 0`; Vite retains a deliberate 550 kB renderer budget so genuine future growth warns while the current 527 kB shell is within budget.

## Verification

- Exact toolchain: Node 24.15.0 and npm 12.0.1.
- Full automated gate: 130 test files passed; 580 tests passed; 1 intentionally skipped.
- `npm run lint`: passed with zero warnings.
- TypeScript/Vite production build: passed without warnings.
- macOS arm64 unpacked package and packaged runtime closure: passed. The local development package is intentionally unsigned; release signing still requires a valid Developer ID identity.
- Normal-profile packaged inspection: two durable image cards restored after restart, both decoded successfully, no failure cards or success toast; full viewer exposed the correct accessible label/alt text, 2400 px bounded derivative, modal focus, and inert background.
- Independent final review: Blocker 0, High 0, Medium 0, Low 0.

## Physical gates

- A user-consented macOS Region/Window/Display capture remains the final OS-permission confirmation; no unattended screen capture was initiated.
- Native Windows Print Screen/source-picker behavior remains a physical Windows validation item. Automated migration coverage protects existing Windows preferences.
