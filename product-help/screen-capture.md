# Screen Capture and Markup

Screen Capture + Markup is a manual, user-triggered screenshot workflow. It is not the separate opt-in Recall-style activity capture feature and never starts periodic background monitoring from the manual capture controls.

## Starting a capture

Open **Capture** from the app or use the configured global shortcut. The default is **Command–Shift–8** on macOS and **Print Screen** on Windows, subject to OS/other-app shortcut conflicts. Region, window, and display choices use the platform’s available capture source/permission path.

macOS Screen Recording permission may be required. A user-initiated capture makes the real macOS capture request so a fresh or reset install can display consent; Waypoint no longer rejects the attempt before macOS can ask. If consent is still absent, Settings opens the exact Screen Recording pane and explains the required one-time relaunch. Waypoint rejects invalid black frames rather than saving false success. An ad-hoc development build has a version-specific macOS privacy identity, so future unsigned updates can require another grant. Stable permission continuity requires an authorized Apple signing identity; Waypoint does not install a broad local signing certificate to bypass that boundary.

## Screenshot Ready actions

After capture, the preview offers:

- **Copy** to the local clipboard.
- **Save locally** through the system save flow.
- **Annotate** in the layered editor.
- **Add to Chat** as a visible image attachment in the selected chat.
- **Add to Knowledge** with capture provenance.
- **Discard** the local capture.

Adding to Chat is complete when the image thumbnail appears in the composer; there is no persistent success notification. Sent image thumbnails persist and reopen through the protected viewer. Re-adding the same source after it has been sent is allowed; a concurrent duplicate queue action is deduplicated.

## Markup editor

The editor supports crop, arrow, line, rectangle, ellipse, text, numbered callouts, highlighter, freehand, move/resize/select, undo/redo, color/stroke controls, blur, pixelate, and irreversible redaction. The canvas adapts and scrolls when necessary while the primary Save/Done/Discard actions remain visible.

Flattening creates a new source revision for future exports/copies. Prior independent Chat, Knowledge, saved-file, or backup copies are not retroactively rewritten, and the UI warns about that boundary.

## Current limitations

macOS capture still needs the user’s OS consent for a real physical capture. Windows Print Screen, source picker, and permission behavior require Windows validation. Scrolling capture, pin-to-screen, recording/GIF, and export backgrounds are tracked later features.

## Privacy and data handling

Captures are workspace-owned local objects with provenance, retention, cleanup, backup/restore, sync policy, and hard-deletion behavior. They are never automatically uploaded to a model. Image analysis happens only after an explicit user request through an available image-capable route.
