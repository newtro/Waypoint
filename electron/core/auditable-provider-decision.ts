export function auditableProviderDecision(request:{kind:string;detail:Record<string,unknown>},decision:Record<string,unknown>):Record<string,unknown>{
  if(request.kind==='mcp_elicitation'){
    const content=decision.content&&typeof decision.content==='object'&&!Array.isArray(decision.content)?Object.fromEntries(Object.keys(decision.content as Record<string,unknown>).map((key)=>[key,'[redacted]'])):decision.content==null?decision.content:'[redacted]'
    return{...decision,...('content' in decision?{content}:{})}
  }
  if(request.kind!=='question'||!Array.isArray(request.detail.questions))return decision
  const secretIds=new Set(request.detail.questions.map((item)=>item&&typeof item==='object'?item as Record<string,unknown>:{}).filter((question)=>question.isSecret===true&&typeof question.id==='string').map((question)=>String(question.id)))
  if(!secretIds.size)return decision
  const answers=decision.answers&&typeof decision.answers==='object'&&!Array.isArray(decision.answers)?{...(decision.answers as Record<string,unknown>)}:undefined
  if(answers)for(const id of secretIds)if(id in answers)answers[id]=['[redacted]']
  return{...decision,...(answers?{answers}:{}),...('answer' in decision?{answer:'[redacted]'}:{})}
}
