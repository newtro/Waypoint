export type CuratedOpenRouterModel={name:string;id:string;pricing?:string}
export const CURATED_OPENROUTER_MODELS:readonly CuratedOpenRouterModel[]=[
  {name:'Kimi K3',id:'moonshotai/kimi-k3'},
  {name:'Z.ai GLM 5.2',id:'z-ai/glm-5.2'},
  {name:'Qwen 3.8 Max',id:'qwen/qwen3.8-max',pricing:'$2/M input · $6/M output'},
  {name:'DeepSeek V4 Flash',id:'deepseek/deepseek-v4-flash'},
]

export type OpenRouterModelChoice={name:string;id:string;legacy:boolean;pricing?:string}

export function openRouterModelChoices(saved:string):OpenRouterModelChoice[]{
  const curated=CURATED_OPENROUTER_MODELS.map((model)=>({...model,legacy:false}))
  const value=saved.trim()
  return value&&!CURATED_OPENROUTER_MODELS.some((model)=>model.id===value)?[{name:'Legacy / custom saved model',id:value,legacy:true},...curated]:curated
}
