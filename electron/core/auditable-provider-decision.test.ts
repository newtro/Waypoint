import{describe,expect,it}from'vitest'
import{auditableProviderDecision}from'./auditable-provider-decision.js'

describe('auditable provider decisions',()=>{
  it('never persists MCP elicitation values while retaining field-level audit shape',()=>{const result=auditableProviderDecision({kind:'mcp_elicitation',detail:{mode:'openai/form'}},{content:{password:'SUPERSECRET',region:'east'},clientNote:'submitted'});expect(result).toEqual({content:{password:'[redacted]',region:'[redacted]'},clientNote:'submitted'});expect(JSON.stringify(result)).not.toContain('SUPERSECRET')})
  it('redacts only secret native question answers',()=>expect(auditableProviderDecision({kind:'question',detail:{questions:[{id:'public',isSecret:false},{id:'secret',isSecret:true}]}},{answers:{public:['yes'],secret:['hidden']}})).toEqual({answers:{public:['yes'],secret:['[redacted]']}}))
})
