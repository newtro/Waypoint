import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'

const styles=readFileSync(new URL('../../src/styles.css',import.meta.url),'utf8')
describe('modern chat-first desktop shell',()=>{
  it('uses the full viewport with one persistent left navigation and one transcript scroll region',()=>{
    expect(styles).toMatch(/\.app-frame\{[^}]*height:100dvh[^}]*grid-template-columns:280px minmax\(0,1fr\)[^}]*overflow:hidden/)
    expect(styles).toMatch(/\.left-sidebar\{[^}]*height:100dvh[^}]*overflow:hidden/)
    expect(styles).toMatch(/\.transcript\{[^}]*flex:1[^}]*min-height:0[^}]*overflow-y:auto/)
  })
  it('grounds one composer without turning it into another scroll panel',()=>{
    expect(styles).toMatch(/\.composer-dock\{[^}]*position:absolute[^}]*bottom:0/)
    expect(styles).toMatch(/\.composer textarea\{[^}]*max-height:180px[^}]*resize:none/)
  })
  it('uses the central pane width at normal and maximized desktop sizes',()=>{
    expect(styles).toMatch(/\.transcript\{padding-left:clamp\(24px,4vw,64px\);padding-right:clamp\(24px,4vw,64px\)\}/)
    expect(styles).toMatch(/\.composer-dock\{padding-left:clamp\(24px,4vw,64px\);padding-right:clamp\(24px,4vw,64px\)\}/)
  })
  it('keeps secondary knowledge invoked in a right drawer',()=>expect(styles).toMatch(/\.right-drawer\{[^}]*position:fixed[^}]*right:0[^}]*bottom:0/))
  it('provides keyboard focus, reduced motion, and responsive sidebar behavior',()=>{
    expect(styles).toMatch(/button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible\{[^}]*outline:/)
    expect(styles).toMatch(/@media\(prefers-reduced-motion:reduce\)/)
    expect(styles).toMatch(/@media\(max-width:800px\)[\s\S]*?\.left-sidebar\{[^}]*position:fixed[^}]*transform:translateX\(-103%\)/)
  })
})
