const requiredNode = '24.15.'
const requiredNpm = /^npm\/12\.0\./
const userAgent = process.env.npm_config_user_agent ?? ''

if (!process.version.startsWith(`v${requiredNode}`) || !requiredNpm.test(userAgent)) {
  console.error(`Waypoint installs require Node 24.15.x and npm 12.0.x; received ${process.version} and ${userAgent || 'an unknown package manager'}.`)
  process.exit(1)
}
