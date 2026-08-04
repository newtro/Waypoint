import {mkdtempSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WorkspaceStore} from './store.js'
import {CURATED_OPENROUTER_MODELS,openRouterModelChoices} from '../../src/openrouter-model-catalog.js'
import {decideHostedRoute,summarizeUsage,type OpenRouterSettings} from './openrouter-provider.js'

const settings=(strategicModel:string,everydayModel:string):OpenRouterSettings=>({enabled:true,liveRequestsEnabled:true,strategicModel,everydayModel,fallbackProvider:'codex',monthlyCapMicros:1_000_000,ytdCapMicros:5_000_000,perRequestCapMicros:100_000,warningPercent:80})

describe('curated OpenRouter model settings',()=>{
  it('publishes only the four verified exact selectable identifiers',()=>{expect(CURATED_OPENROUTER_MODELS).toEqual([{name:'Kimi K3',id:'moonshotai/kimi-k3'},{name:'Z.ai GLM 5.2',id:'z-ai/glm-5.2'},{name:'Qwen 3.8 Max',id:'qwen/qwen3.8-max',pricing:'$2/M input · $6/M output'},{name:'DeepSeek V4 Flash',id:'deepseek/deepseek-v4-flash'}]);expect(JSON.stringify(CURATED_OPENROUTER_MODELS)).not.toContain('qwen3.7')})
  it('preserves an earlier Qwen 3.7 or unknown saved value as legacy/custom',()=>{expect(openRouterModelChoices('qwen/qwen3.7-max')[0]).toEqual({name:'Legacy / custom saved model',id:'qwen/qwen3.7-max',legacy:true});expect(openRouterModelChoices('vendor/retired-model')[0]).toMatchObject({id:'vendor/retired-model',legacy:true});expect(openRouterModelChoices('moonshotai/kimi-k3').filter((item)=>item.legacy)).toEqual([]);expect(openRouterModelChoices('')).toHaveLength(4)})
  it('persists and reopens curated and legacy values without changing activation or caps',()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-model-picker-')),database=path.join(root,'waypoint.sqlite'),store=new WorkspaceStore(database),expected=settings('qwen/qwen3.7-max','qwen/qwen3.8-max');store.setOpenRouterSettings(expected);store.close();const reopened=new WorkspaceStore(database);expect(reopened.openRouterSettings()).toEqual(expected);reopened.close()})
  it('feeds strategic and everyday choices into the existing route decision',()=>{const configured=settings('z-ai/glm-5.2','deepseek/deepseek-v4-flash'),summary=summarizeUsage([],configured,new Date('2026-08-04T12:00:00Z'));expect(decideHostedRoute({settings:configured,keyConfigured:true,summary,role:'strategic',availableSubscriptions:['codex']})).toMatchObject({provider:'openrouter',model:'z-ai/glm-5.2'});expect(decideHostedRoute({settings:configured,keyConfigured:true,summary,role:'everyday',availableSubscriptions:['codex']})).toMatchObject({provider:'openrouter',model:'deepseek/deepseek-v4-flash'})})
  it('renders accessible strategic/everyday selectors without a guessed or stale Qwen option',()=>{const source=readFileSync(new URL('../../src/main.tsx',import.meta.url),'utf8');expect(source).toContain('aria-label="OpenRouter strategic model"');expect(source).toContain('aria-label="OpenRouter everyday model"');expect(source).not.toContain('Qwen 3.8 Max Preview');expect(source).not.toContain('qwen/qwen3.7-max')})
})
