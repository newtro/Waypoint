export type ActivationSettings={enabled:boolean;liveRequestsEnabled:boolean;strategicModel:string;everydayModel:string}
export function nextOpenRouterActivation<T extends ActivationSettings>(current:T,keyConfigured:boolean):T{
  if(!keyConfigured)throw new Error('Store an OpenRouter key in protected storage before enabling hosted requests.')
  const active=current.enabled&&current.liveRequestsEnabled
  return{...current,enabled:!active,liveRequestsEnabled:!active,strategicModel:current.strategicModel||'moonshotai/kimi-k3',everydayModel:current.everydayModel||'deepseek/deepseek-v4-flash'}
}
