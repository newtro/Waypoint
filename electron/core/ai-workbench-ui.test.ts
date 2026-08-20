import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {failureAdvice} from '../../src/ai-workbench-ui.js'

describe('visible AI workbench evidence',()=>{
  it('turns authentication, legacy timeout and generic failures into actionable guidance',()=>{
    expect(failureAdvice({status:'failed',cli:'claude',errorMessage:'Authentication required'})).toMatch(/Terminal, sign in/)
    expect(failureAdvice({status:'timed_out',cli:'codex'})).toMatch(/legacy Waypoint deadline/)
    expect(failureAdvice({status:'failed',cli:'codex'})).toMatch(/Check Health/)
  })
  it('renders streaming state, truthful provider capability, cancellation, and retry controls without dashboard chrome',()=>{
    const source=readFileSync(new URL('../../src/main.tsx',import.meta.url),'utf8')
    for(const evidence of ['aria-live="polite"','uniqueExecutionEvents(run)','local CLI','Images use Claude structured image input','Grok ACP receives text','No completed Claude or Grok result','String(parent.cli) as "claude" | "grok"','Waypoint applies no AI time or output cap','OpenRouter image model','Stop','Retry','compatibilityError'])expect(source).toContain(evidence)
    expect(source).not.toContain('child task started with the parent profile and a 60-second cap')
    expect(source).not.toContain('Add note')
  })
})
