# Dark mode with flare evidence

Status: clean; ready to commit.

## Delivered

- Device-local System, Light, and Dark choices live at the top of Settings and use accessible radio semantics. Unknown or unavailable storage safely falls back to System.
- Appearance is applied before React renders, follows live OS changes in System mode, and persists across packaged-app restart without flashing the wrong theme.
- Dark uses Waypoint's midnight-cartography language: deep green-black terrain, raised ink surfaces, mint navigation/focus, warm amber detail, a restrained compass-orbit halo, and a focused composer glow.
- Theme coverage includes the conversation shell, Markdown/code, execution history, attachments/viewer, Settings, Screen Capture studio/editor, In-App Browser, onboarding, dialogs, responsive layouts, and reduced-motion users.
- The preference is explicitly local to the device. It neither changes workspace data nor enters backup/sync/relay payloads.

## Verification

- Exact toolchain: Node 24.15.0 and npm 12.0.1.
- Full automated gate after review repairs: 132 test files passed; 587 tests passed; 1 intentionally skipped.
- `npm run lint`: passed with zero warnings under `--max-warnings 0`.
- TypeScript/Vite production build: passed; renderer JavaScript remained below the explicit 550 kB budget.
- macOS arm64 unpacked package and packaged runtime closure: passed. Local development packaging intentionally skipped signing; release signing remains an external identity gate.
- Normal-profile packaged inspection: visually verified Settings, empty and populated chat, execution timeline, composer, capture settings, and a 900 x 650 short-window layout in Dark.
- Live UI/restart evidence: System resolved to the current dark macOS appearance, Light persisted after restart, Dark persisted after restart, and the final package remains in Dark.

## Review

- First review found two High contrast defects and two Medium appearance/keyboard defects. Repairs give mint primary actions dark readable labels, restore capture dismiss contrast, make explicit Light authoritative over OS dark for attachments, and add roving Arrow/Home/End radio behavior.
- Fresh independent computed-style and interaction review: Blocker 0, High 0, Medium 0, Low 0.
