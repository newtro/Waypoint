export type ActivationSettings={enabled:boolean;liveRequestsEnabled:boolean;strategicModel:string;everydayModel:string;attachmentModel:string}
export function nextOpenRouterActivation<T extends ActivationSettings>(current:T,keyConfigured:boolean):T{
  if(!keyConfigured)throw new Error('Store an OpenRouter key in protected storage before enabling hosted requests.')
  const active=current.enabled&&current.liveRequestsEnabled
  if(active)return{...current,enabled:false,liveRequestsEnabled:false}
  return{...current,enabled:true,liveRequestsEnabled:true,strategicModel:current.strategicModel||'moonshotai/kimi-k3',everydayModel:current.everydayModel||'deepseek/deepseek-v4-flash',attachmentModel:current.attachmentModel||'moonshotai/kimi-k3'}
}
