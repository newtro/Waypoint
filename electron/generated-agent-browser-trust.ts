// Reviewed package closures. Preparation must match one of these exact
// platform-specific digests; a build never rewrites or self-approves trust.
export const EXPECTED_AGENT_BROWSER_CLOSURES: Readonly<Record<string, { closureSha256: string; browserExecutable: string }>> = {
  'darwin-arm64': { closureSha256: '56c1ad6f43281d1d2bf273f8b2b2388e0c8d2ac2bec91ee7bfc76a8f42b7dce9', browserExecutable: 'chromium/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' },
  'win32-x64': { closureSha256: '3d13f84fc576f63850e4676e9dfd84c6e85980581123240d081cfcd629006a17', browserExecutable: 'chromium\\chrome-win64\\chrome.exe' },
}
