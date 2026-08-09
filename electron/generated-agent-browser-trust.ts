// Reviewed package closures. Preparation must match one of these exact
// platform-specific digests; a build never rewrites or self-approves trust.
// macOS ad-hoc signing produces one reviewed closure on current local macOS
// and one on GitHub's macos-15 runner, while preserving the same locked input.
export const EXPECTED_AGENT_BROWSER_CLOSURES: Readonly<Record<string, { closureSha256: readonly string[]; browserExecutable: string }>> = {
  'darwin-arm64': { closureSha256: ['56c1ad6f43281d1d2bf273f8b2b2388e0c8d2ac2bec91ee7bfc76a8f42b7dce9', '36b3d5ba9b0715d9ac65815624f9f736bdbc225398ed4f6a2c42f34f2c37e974'], browserExecutable: 'chromium/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' },
  'win32-x64': { closureSha256: ['3d13f84fc576f63850e4676e9dfd84c6e85980581123240d081cfcd629006a17'], browserExecutable: 'chromium\\chrome-win64\\chrome.exe' },
}
