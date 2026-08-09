# GitHub CI, merge release, and main protection

## Outcome

Every pull request and main update must pass the pinned zero-warning verification gate. A successful CI run for a push to `main` builds immutable unsigned private prereleases for the supported macOS arm64 and Windows x64 targets, publishes checksums, and records the exact source commit. Standard protection keeps force pushes/deletion off and requires pull requests, CI, review, and resolved conversations for non-admin collaborators.

## Acceptance criteria

1. CI runs on pull requests, main pushes, merge queue events, and manual dispatch with read-only repository authority.
2. CI uses Node 24.15.0/npm 12.0.1, locked dependencies, full tests, zero-warning lint, production build, dependency policy, and a high-severity audit gate.
3. Release runs only after a successful main-push CI event, checks out the exact verified SHA, and cannot publish partial platform output. There is no manual-dispatch bypass.
4. macOS arm64 ZIP and Windows x64 installer builds include the reviewed native runtime/resources and pass packaged runtime closure on their native hosted runners.
5. Releases are immutable versioned prereleases with SHA-256 checksums and explicit unsigned/not-notarized status. No secret, signing identity, external account, VM, Docker, or update channel is introduced.
6. Actions are pinned to immutable commit SHAs and use least-privilege tokens; only the final publish job receives `contents: write`.
7. Linux is not published until its native voice/browser/platform closure and product acceptance gate exist; absence is documented rather than represented as support.
8. `main` prevents force pushes/deletion and requires a pull request, conversation resolution, linear history, and the successful `Verify` check. Required approvals remain zero until a second reviewer exists, because the sole owner cannot approve their own pull request. Repository admins retain an emergency bypass.
9. Workflow lint, focused policy tests, full repository gate, independent severity-rated review, live Actions execution, release asset inspection, and branch-protection readback pass.
