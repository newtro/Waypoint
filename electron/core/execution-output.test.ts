import{describe,expect,it}from'vitest';import{canonicalExecutionText}from'./execution-output.js'
describe('canonicalExecutionText',()=>{it('assembles Claude deltas but prefers the final canonical message',()=>{const deltas=[{type:'text',text:'Hello ',rawType:'stream_event.content_block_delta'},{type:'text',text:'world',rawType:'stream_event.content_block_delta'}];expect(canonicalExecutionText('claude',deltas)).toBe('Hello world');expect(canonicalExecutionText('claude',[...deltas,{type:'text',text:'Hello world!',rawType:'assistant'}])).toBe('Hello world!')})})

describe('current Claude Agent SDK output',()=>{it('preserves every partial text delta when a run ends without a final result',()=>{const deltas=[{type:'text',text:'Useful ',rawType:'claude.stream.text_delta'},{type:'text',text:'partial answer',rawType:'claude.stream.text_delta'}];expect(canonicalExecutionText('claude',deltas)).toBe('Useful partial answer');expect(canonicalExecutionText('claude',[...deltas,{type:'text',text:'Final answer',rawType:'claude.result'}])).toBe('Final answer')})})

describe('provider-authored response sections',()=>{
  it('joins deltas within one Codex item and separates distinct message items',()=>{
    expect(canonicalExecutionText('codex',[
      {type:'text',text:'First ',metadata:{itemId:'message-1'}},
      {type:'text',text:'section.',metadata:{itemId:'message-1'}},
      {type:'tool',name:'Search completed'},
      {type:'text',text:'Second section.',metadata:{itemId:'message-2'}},
    ])).toBe('First section.\n\nSecond section.')
  })

  it('recovers legacy section boundaries around durable tool events',()=>{
    expect(canonicalExecutionText('codex',[
      {type:'text',text:'I will inspect this.'},
      {type:'tool',name:'Command completed'},
      {type:'diagnostic',name:'Usage'},
      {type:'text',text:'The repair is complete.'},
    ])).toBe('I will inspect this.\n\nThe repair is complete.')
  })
})
