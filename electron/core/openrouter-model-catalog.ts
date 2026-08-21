import type {ThinkingEffort} from '../../src/model-thinking.js'
export type CuratedOpenRouterModel={name:string;id:string;pricing?:string;inputModalities:readonly ('text'|'image')[];thinking:{supported:readonly ThinkingEffort[];defaultEffort:ThinkingEffort;mandatory:boolean}}
export const CURATED_OPENROUTER_MODELS:readonly CuratedOpenRouterModel[]=[
  {name:'Kimi K3',id:'moonshotai/kimi-k3',inputModalities:['text','image'],thinking:{supported:['none','low','high','max'],defaultEffort:'max',mandatory:false}},
  {name:'Z.ai GLM 5.2',id:'z-ai/glm-5.2',inputModalities:['text'],thinking:{supported:['none','high','xhigh'],defaultEffort:'high',mandatory:false}},
  {name:'Qwen 3.8 Max',id:'qwen/qwen3.8-max',pricing:'$2/M input · $6/M output',inputModalities:['text','image'],thinking:{supported:['minimal','low','medium','high','xhigh'],defaultEffort:'xhigh',mandatory:true}},
  {name:'DeepSeek V4 Flash',id:'deepseek/deepseek-v4-flash',inputModalities:['text'],thinking:{supported:['none','high','xhigh'],defaultEffort:'high',mandatory:false}},
]

export type OpenRouterModelChoice={name:string;id:string;legacy:boolean;pricing?:string;inputModalities:readonly ('text'|'image')[]}

export function openRouterModelChoices(saved:string):OpenRouterModelChoice[]{
  const curated=CURATED_OPENROUTER_MODELS.map((model)=>({...model,legacy:false}))
  const value=saved.trim()
  return value&&!CURATED_OPENROUTER_MODELS.some((model)=>model.id===value)?[{name:'Legacy / custom saved model',id:value,legacy:true,inputModalities:['text']},...curated]:curated
}

export function openRouterImageModelChoices(saved:string):OpenRouterModelChoice[]{
  const selected=CURATED_OPENROUTER_MODELS.find((model)=>model.id===saved)
  const curated=CURATED_OPENROUTER_MODELS.filter((model)=>model.inputModalities.includes('image')).map((model)=>({...model,legacy:false}))
  return saved&&(!selected||!selected.inputModalities.includes('image'))?[{name:'Saved model — not verified for images',id:saved,legacy:true,inputModalities:['text']},...curated]:curated
}

export function openRouterModelAcceptsImages(modelId:string):boolean{
  return CURATED_OPENROUTER_MODELS.some((model)=>model.id===modelId&&model.inputModalities.includes('image'))
}

export function openRouterModelThinking(modelId:string){
  return CURATED_OPENROUTER_MODELS.find((model)=>model.id===modelId)?.thinking
}
