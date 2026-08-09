import{describe,expect,it}from'vitest';import{nextOpenRouterActivation}from'./openrouter-activation.js'
const base={enabled:false,liveRequestsEnabled:false,strategicModel:'',everydayModel:'',attachmentModel:'',fallbackProvider:'codex'}
describe('nextOpenRouterActivation',()=>{
 it('requires a protected key and enables both paid-request gates in one explicit action',()=>{expect(()=>nextOpenRouterActivation(base,false)).toThrow('protected storage');expect(nextOpenRouterActivation(base,true)).toEqual({...base,enabled:true,liveRequestsEnabled:true,strategicModel:'moonshotai/kimi-k3',everydayModel:'deepseek/deepseek-v4-flash',attachmentModel:'moonshotai/kimi-k3'})})
 it('preserves configured and legacy models rather than migrating them silently',()=>{const legacy={...base,strategicModel:'legacy/strategic',everydayModel:'legacy/everyday'};expect(nextOpenRouterActivation(legacy,true)).toMatchObject({strategicModel:'legacy/strategic',everydayModel:'legacy/everyday'})})
 it('turns both gates off together without changing provider preferences',()=>{const active={...base,enabled:true,liveRequestsEnabled:true,strategicModel:'moonshotai/kimi-k3',everydayModel:'custom/saved'};expect(nextOpenRouterActivation(active,true)).toEqual({...active,enabled:false,liveRequestsEnabled:false})})
})
