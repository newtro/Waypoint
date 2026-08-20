import { describe, expect, it } from 'vitest'
import { executionAnswerText, failureAdvice } from './ai-workbench-ui.js'

describe('provider execution presentation', () => {
  it('shows Claude streaming text without duplicating its final result', () => {
    expect(executionAnswerText({ cli: 'claude', events: [
      { type: 'text', text: 'Working ', rawType: 'claude.stream.text_delta' },
      { type: 'text', text: 'now', rawType: 'claude.stream.text_delta' },
    ] })).toBe('Working now')
    expect(executionAnswerText({ cli: 'claude', events: [
      { type: 'text', text: 'Working ', rawType: 'claude.stream.text_delta' },
      { type: 'text', text: 'done', rawType: 'claude.result' },
    ] })).toBe('done')
  })

  it('describes legacy timeouts without suggesting a longer Waypoint profile', () => {
    expect(failureAdvice({ cli: 'claude', status: 'timed_out' })).toContain('legacy Waypoint deadline')
    expect(failureAdvice({ cli: 'claude', status: 'timed_out' })).not.toContain('longer approved profile')
  })
})
