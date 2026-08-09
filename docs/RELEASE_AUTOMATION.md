# Release automation

Waypoint uses two GitHub Actions workflows:

- **CI** runs for pull requests, merge groups, pushes to `main`, and manual dispatch. It installs the repository-pinned Node/npm toolchain, uses the committed lockfile, and runs zero-warning lint, the complete test suite, production build, dependency policy, and a high-severity dependency audit.
- **Merge release** starts only after CI succeeds for a push to `main`. It checks out the exact verified commit, builds on native hosted runners, verifies package closure, stages and verifies a draft, and then publishes an immutable private GitHub prerelease with SHA-256 checksums. It has no manual-dispatch bypass.

## Current release assets

| Asset | Runner | State |
| --- | --- | --- |
| macOS arm64 ZIP | `macos-15`, with an `arm64` runtime assertion | Automated unsigned prerelease |
| Windows x64 installer | `windows-2025` x64 | Automated unsigned prerelease |
| Linux | — | Not published; native browser/voice/package closure and product acceptance are not yet reviewed |

The prerelease version is `0.0.<release-workflow-run-number>` and is bound to the verified `main` commit. The release job cannot publish if either native package is missing or fails closure verification. It uploads to a resumable draft, verifies the exact asset set and checksums, then publishes. A rerun resumes a matching draft or verifies an already-published release for the same commit.

Package closure exercises the shipped one-shot Fast Local worker from process launch through complete first-segment audio receipt. The non-representative shared GitHub runners use a strict three-second closure ceiling and print the measured value; this catches missing, stalled, or grossly regressed native runtime behavior without representing shared-runner speed as product latency. Waypoint's product acceptance target remains at most one second on representative user hardware, and local/default package verification continues to enforce that target. The latest hosted evidence was 1.163 seconds on `macos-15` and 2.156 seconds on `windows-2025`; Windows user-hardware voice latency remains a physical acceptance item rather than a release-automation claim.

## Signing boundary

The automated artifacts are private development previews. They are not Apple-notarized and do not carry production Apple or Windows publisher identities. The workflow never invents or downloads signing credentials. Production signing/notarization requires separately provisioned GitHub secrets, certificate custody and rotation decisions, native verification, and an explicit signed-release gate.

The macOS build may therefore require Finder’s **Open** confirmation. Windows may show an unknown-publisher warning. These warnings must not be hidden in release notes or represented as release readiness.

## Main protection

`main` requires the `Verify` check, a pull request, resolved review conversations, and linear history. Force pushes and branch deletion are disabled. Required approvals are currently zero because the private repository has one owner, who cannot approve their own pull request; this should increase when a second reviewer is added. Repository administrators retain an emergency bypass, while routine work should still use pull requests.
