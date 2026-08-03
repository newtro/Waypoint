import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')

describe('desktop responsive shell', () => {
  it('fills the available viewport instead of retaining a fixed desktop width', () => {
    const shellRule = styles.match(/\.shell\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(shellRule).toContain('width: 100%')
    expect(shellRule).toContain('min-height: 100vh')
    expect(shellRule).not.toContain('max-width')
  })

  it('adapts the two-column workspace before the minimum Electron window width', () => {
    expect(styles).toMatch(/@media \(max-width: 980px\)[\s\S]*?\.columns\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/)
    expect(styles).toMatch(/\.shell header\s*\{[^}]*flex-wrap: wrap/)
    expect(styles).toMatch(/\.header-actions,\.card-actions\s*\{[^}]*flex-wrap: wrap/)
  })

  it('allows card flex children and long unbroken content to shrink without horizontal overflow', () => {
    expect(styles).toMatch(/\.card-main\s*\{[^}]*min-width:0/)
    expect(styles).toMatch(/\.cards article>div:first-child\s*\{[^}]*min-width:0/)
    expect(styles).toMatch(/\.cards h4,\.cards p,\.cards small\s*\{[^}]*overflow-wrap: anywhere/)
  })
})
