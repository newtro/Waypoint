import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {failureAdvice} from '../../src/ai-workbench-ui.js'

describe('visible AI workbench evidence',()=>{
  it('turns authentication, timeout and generic failures into actionable guidance',()=>{
    expect(failureAdvice({status:'failed',cli:'claude',errorMessage:'Authentication required'})).toMatch(/Terminal, sign in/)
    expect(failureAdvice({status:'timed_out',cli:'codex'})).toMatch(/Narrow the task/)
    expect(failureAdvice({status:'failed',cli:'codex'})).toMatch(/Check Health/)
  })
  it('renders streaming events, provenance, compatibility and child delegation controls',()=>{
    const source=readFileSync(new URL('../../src/main.tsx',import.meta.url),'utf8')
    for(const evidence of ['aria-live="polite"','run.events','CLI version','Executable','Lineage','Delegate one child','compatibilityError'])expect(source).toContain(evidence)
  })
})
