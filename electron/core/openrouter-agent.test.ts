import {describe,expect,it,vi} from 'vitest'
import {FetchOpenRouterTransport,OPENROUTER_MAX_AGENT_TOOL_CALLS,OPENROUTER_MAX_AGENT_TURNS,OpenRouterAgentClient,type OpenRouterAgentTransport,type OpenRouterToolDefinition} from './openrouter-provider.js'

const tools:OpenRouterToolDefinition[]=[{type:'function',function:{name:'workspace_read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}]

describe('OpenRouter bounded agent loop',()=>{
  it('executes a model tool call and persists aggregate authoritative usage',async()=>{
    const completeTurn=vi.fn<OpenRouterAgentTransport['completeTurn']>()
      .mockResolvedValueOnce({responseId:'r1',text:'',assistantMessage:{role:'assistant',content:'',tool_calls:[{id:'c1',type:'function',function:{name:'workspace_read_file',arguments:'{"path":"README.md"}'}}]},toolCalls:[{id:'c1',name:'workspace_read_file',arguments:{path:'README.md'}}],promptTokens:10,completionTokens:2,costMicros:20})
      .mockResolvedValueOnce({responseId:'r2',text:'The file says hello.',assistantMessage:{role:'assistant',content:'The file says hello.'},toolCalls:[],promptTokens:14,completionTokens:5,costMicros:30})
    const executeTool=vi.fn(async()=>'{"status":"completed","output":"hello"}'),client=new OpenRouterAgentClient({completeTurn}),result=await client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'read it',apiKey:'fixture-key',signal:new AbortController().signal,requestCapMicros:100,tools,executeTool})
    expect(result).toMatchObject({text:'The file says hello.',toolCalls:1,receipt:{status:'completed',costMicros:50,promptTokens:24,completionTokens:7,responseId:'r2'}})
    expect(executeTool).toHaveBeenCalledWith({id:'c1',name:'workspace_read_file',arguments:{path:'README.md'}})
    expect(completeTurn.mock.calls[1][0].messages).toContainEqual({role:'tool',tool_call_id:'c1',content:'{"status":"completed","output":"hello"}'})
    expect(completeTurn.mock.calls[1][0].requestCapMicros).toBe(80)
  })
  it('preserves a paid terminal answer when authoritative cost exceeds the reservation',async()=>{
    const client=new OpenRouterAgentClient({completeTurn:async()=>({responseId:'over',text:'answer',assistantMessage:{role:'assistant',content:'answer'},toolCalls:[],promptTokens:1,completionTokens:1,costMicros:101})})
    await expect(client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'x',apiKey:'fixture-key',signal:new AbortController().signal,requestCapMicros:100,tools,executeTool:async()=>''})).resolves.toMatchObject({text:'answer',receipt:{status:'completed',costMicros:101,responseId:'over',errorCode:'provider_cost_cap_exceeded'}})
  })
  it('does not execute a paid tool request after authoritative cost exceeds the reservation',async()=>{
    const executeTool=vi.fn(async()=>''),client=new OpenRouterAgentClient({completeTurn:async()=>({responseId:'over-tool',text:'',assistantMessage:{role:'assistant',content:'',tool_calls:[{id:'c1',type:'function',function:{name:'workspace_read_file',arguments:'{"path":"README.md"}'}}]},toolCalls:[{id:'c1',name:'workspace_read_file',arguments:{path:'README.md'}}],promptTokens:1,completionTokens:1,costMicros:101})})
    await expect(client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'x',apiKey:'fixture-key',signal:new AbortController().signal,requestCapMicros:100,tools,executeTool})).rejects.toMatchObject({message:'provider_cost_cap_exceeded',receipt:{status:'failed',costMicros:101,responseId:'over-tool'}})
    expect(executeTool).not.toHaveBeenCalled()
  })
  it('retains authoritative paid usage when post-stream tool validation fails',async()=>{
    const invalid={id:'paid-invalid-tool',choices:[{delta:{tool_calls:[{index:0,id:'bad id',type:'function',function:{name:'workspace_read_file',arguments:'{"path":"README.md"}'}}]}}]},usage={id:'paid-invalid-tool',choices:[],usage:{prompt_tokens:7,completion_tokens:3,cost:0.5}},sse=['data: '+JSON.stringify(invalid),'data: '+JSON.stringify(usage),'data: [DONE]',''].join('\n'),client=new OpenRouterAgentClient(new FetchOpenRouterTransport((async()=>new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}})) as typeof fetch))
    await expect(client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'x',apiKey:'fixture-key',signal:new AbortController().signal,requestCapMicros:100_000,tools,executeTool:async()=>''})).rejects.toMatchObject({message:'provider_response_invalid',receipt:{status:'failed',responseId:'paid-invalid-tool',promptTokens:7,completionTokens:3,costMicros:500_000}})
  })
  it('bounds zero-cost hosted tool loops independently of tokens and elapsed time',async()=>{let turn=0;const executeTool=vi.fn(async()=>''),client=new OpenRouterAgentClient({completeTurn:async()=>{turn+=1;return{responseId:`loop-${turn}`,text:'',assistantMessage:{role:'assistant',content:'',tool_calls:[{id:`call-${turn}`,type:'function',function:{name:'workspace_read_file',arguments:'{"path":"README.md"}'}}]},toolCalls:[{id:`call-${turn}`,name:'workspace_read_file',arguments:{path:'README.md'}}],promptTokens:0,completionTokens:0,costMicros:0}}});await expect(client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'x',apiKey:'fixture-key',signal:new AbortController().signal,requestCapMicros:100,tools,executeTool})).rejects.toMatchObject({message:'provider_agent_turn_limit',receipt:{status:'failed',costMicros:0}});expect(turn).toBe(OPENROUTER_MAX_AGENT_TURNS);expect(executeTool).toHaveBeenCalledTimes(OPENROUTER_MAX_AGENT_TURNS);expect(OPENROUTER_MAX_AGENT_TOOL_CALLS).toBeGreaterThan(OPENROUTER_MAX_AGENT_TURNS)})
  it('cancels before transport and emits no tool work',async()=>{
    const controller=new AbortController(),completeTurn=vi.fn();controller.abort();const client=new OpenRouterAgentClient({completeTurn})
    await expect(client.run({workspaceId:'w1',role:'everyday',model:'fixture/model',prompt:'x',apiKey:'fixture-key',signal:controller.signal,requestCapMicros:100,tools,executeTool:async()=>''})).rejects.toMatchObject({message:'provider_canceled',receipt:{status:'canceled',costMicros:0}})
    expect(completeTurn).not.toHaveBeenCalled()
  })
})
