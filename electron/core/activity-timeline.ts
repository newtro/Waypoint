import type {ActivityFamily} from './types.js'

export const ACTIVITY_FAMILIES:readonly ActivityFamily[] = ['content','execution','sync','rules','automation','meeting','lifecycle','maintenance']

const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max
const validators:Record<string,(value:unknown)=>boolean>={
  archiveVersion:(value)=>integer(value,1,100),cli:(value)=>value==='codex'||value==='claude',created:(value)=>integer(value,0,1_000_000),device:(value)=>value==='local'||value==='peer',exitCode:(value)=>integer(value,-255,255),localDay:(value)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value),matchCount:(value)=>integer(value,0,1_000_000),role:(value)=>['user','assistant','system','owner','peer'].includes(String(value)),scope:(value)=>['workspace','local'].includes(String(value)),version:(value)=>integer(value,0,1_000_000),
}

export function activityFamily(category:string):ActivityFamily {
  if(category==='ai')return'execution'
  if(category==='knowledge'||category==='briefing'||category==='graph')return'content'
  if(category==='devices')return'sync'
  return (ACTIVITY_FAMILIES as readonly string[]).includes(category)?category as ActivityFamily:'maintenance'
}

export function safeActivityDetails(raw:string):Record<string,string|number|boolean|null>{
  let value:unknown
  try{value=JSON.parse(raw)}catch{return{}}
  if(!value||typeof value!=='object'||Array.isArray(value))return{}
  const safe:Record<string,string|number|boolean|null>={}
  for(const[key,item]of Object.entries(value as Record<string,unknown>))if(validators[key]?.(item))safe[key]=item as string|number|boolean
  return safe
}
