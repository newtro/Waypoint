import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export const BENCHMARK_SUITE_VERSION = 'waypoint-retrieval-v2'
export const EMBEDDING_POLICY_VERSION = 1 as const

export type ProviderId = 'fixture-local' | 'ollama-local' | 'trusted-peer' | 'llama-cpp-local' | 'openai-api'
export type CandidateStatus = 'complete' | 'unavailable' | 'failed' | 'disabled'

export interface EmbeddingProviderDescriptor {
  id: ProviderId; version: string; location: 'local' | 'trusted-peer' | 'external'
  network: 'none' | 'loopback' | 'trusted-peer' | 'internet'; enabled: boolean; auditStatus: string
}
export interface EmbeddingModelDescriptor { id: string; providerId: ProviderId; role: 'quality' | 'baseline' | 'fixture'; minimumMemoryGiB: number; enabled: boolean }
export interface ChunkingPolicy { id: string; version: string; kind: 'whole' | 'sentence'; maxCharacters: number; overlapCharacters: number; productionReady: boolean }
export interface EmbeddingProvenance { provider:string;providerVersion:string;model:string;modelDigest:string;dimensions:number;chunkingPolicy:string;chunkingVersion:string;chunkingDigest:string;suiteVersion:string }
export interface BenchmarkCorpusItem { id:string;topic:string;text:string }
export interface BenchmarkQuery { id:string;expectedTopic:string;text:string }
export interface BenchmarkProvider {
  descriptor: EmbeddingProviderDescriptor
  modelInfo(model:string):Promise<{digest:string;sizeBytes:number;license:string;format?:string;quantization?:string}>
  embed(model:string,inputs:string[]):Promise<number[][]>
  runtimeMemoryMiB?(model:string):Promise<number|null>
}
export interface BenchmarkReport {
  status:CandidateStatus; candidate:{providerId:ProviderId;model:string};suiteVersion:string;chunking:{id:string;version:string;digest:string;productionReady:boolean};isolatedIndex:true
  quality?:{recallAt1:number;recallAt3:number;meanReciprocalRank:number};performance?:{indexMs:number;queryMs:number;documentsPerSecond:number;harnessRssDeltaMiB:number;providerRuntimeMemoryMiB:number|null}
  provenance?:EmbeddingProvenance;model?:{sizeBytes:number;license:string;format?:string;quantization?:string};auditStatus:string;failure?:string
}

export const PROVIDERS:readonly EmbeddingProviderDescriptor[]=[
  {id:'fixture-local',version:'1',location:'local',network:'none',enabled:true,auditStatus:'Bundled deterministic test baseline; not a semantic production model'},
  {id:'ollama-local',version:'1',location:'local',network:'loopback',enabled:true,auditStatus:'Optional native runtime; model license and digest required at benchmark time'},
  {id:'trusted-peer',version:'planned',location:'trusted-peer',network:'trusted-peer',enabled:false,auditStatus:'Disabled pending transport, workspace policy, fallback, and physical-peer validation'},
  {id:'llama-cpp-local',version:'planned',location:'local',network:'none',enabled:false,auditStatus:'Disabled until native packaging, model metadata, and API compatibility are reviewed'},
  {id:'openai-api',version:'planned',location:'external',network:'internet',enabled:false,auditStatus:'Disabled; requires user API key and explicit cost/data authorization'},
] as const
export const MODELS:readonly EmbeddingModelDescriptor[]=[
  {id:'fixture-trigram-v1',providerId:'fixture-local',role:'fixture',minimumMemoryGiB:0,enabled:true},
  {id:'qwen3-embedding:4b',providerId:'ollama-local',role:'quality',minimumMemoryGiB:8,enabled:true},
  {id:'qwen3-embedding:8b',providerId:'ollama-local',role:'quality',minimumMemoryGiB:16,enabled:true},
  {id:'bge-m3',providerId:'ollama-local',role:'baseline',minimumMemoryGiB:4,enabled:true},
] as const
export const CHUNKING_POLICIES:readonly ChunkingPolicy[]=[
  {id:'whole-document',version:'1',kind:'whole',maxCharacters:100_000,overlapCharacters:0,productionReady:true},
  {id:'sentence-window',version:'1',kind:'sentence',maxCharacters:1_200,overlapCharacters:120,productionReady:false},
] as const
export const CHUNKING_BACKENDS=[
  {id:'builtin',enabled:true,runtime:'native-typescript',auditStatus:'Bundled and dependency-audited with Waypoint'},
  {id:'chonkie',enabled:false,runtime:'python',auditStatus:'Disabled pending Python/runtime packaging, license/dependency audit, document-type support, and native macOS/Windows setup review'},
] as const

export function chunkingDigest(policy:ChunkingPolicy):string{return createHash('sha256').update(JSON.stringify(policy)).digest('hex')}
export function storedChunkingProvenance(policy:ChunkingPolicy):string{return`${policy.id}@${policy.version}:${chunkingDigest(policy)}`}
export function chunkText(text:string,policy:ChunkingPolicy):string[]{
  const bounded=text.normalize('NFKC').slice(0,100_000)
  if(policy.kind==='whole')return bounded.trim()?[bounded.trim()]:[]
  const sentences=bounded.split(/(?<=[.!?])\s+/),chunks:string[]=[];let current=''
  for(const sentence of sentences){if(sentence.length>policy.maxCharacters){if(current)chunks.push(current);current='';for(let offset=0;offset<sentence.length;offset+=policy.maxCharacters-policy.overlapCharacters)chunks.push(sentence.slice(offset,offset+policy.maxCharacters));continue}if(current&&current.length+1+sentence.length>policy.maxCharacters){chunks.push(current);current=current.slice(-policy.overlapCharacters)}current=`${current}${current?' ':''}${sentence}`}
  if(current)chunks.push(current);return chunks.slice(0,256)
}
export function requiresReindex(previous:EmbeddingProvenance,next:EmbeddingProvenance):boolean{return ['provider','providerVersion','model','modelDigest','dimensions','chunkingPolicy','chunkingVersion','chunkingDigest'].some((key)=>previous[key as keyof EmbeddingProvenance]!==next[key as keyof EmbeddingProvenance])}

function cosine(left:number[],right:number[]):number{if(left.length!==right.length||!left.length)return -1;let dot=0,l=0,r=0;for(let i=0;i<left.length;i++){dot+=left[i]*right[i];l+=left[i]**2;r+=right[i]**2}return l&&r?dot/Math.sqrt(l*r):-1}
function beforeDeadline<T>(operation:Promise<T>,deadline:number):Promise<T>{const remaining=Math.max(1,deadline-performance.now());return Promise.race([operation,new Promise<T>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Embedding benchmark exceeded its total time limit')),remaining);operation.finally(()=>clearTimeout(timer)).catch(()=>undefined)})])}
async function embedBatches(provider:BenchmarkProvider,model:string,inputs:string[],deadline:number):Promise<number[][]>{const result:number[][]=[];for(let offset=0;offset<inputs.length;offset+=64)result.push(...await beforeDeadline(provider.embed(model,inputs.slice(offset,offset+64)),deadline));return result}
export async function runEmbeddingBenchmark(input:{provider:BenchmarkProvider;model:string;policy:ChunkingPolicy;corpus:BenchmarkCorpusItem[];queries:BenchmarkQuery[];timeoutMs?:number}):Promise<BenchmarkReport>{
  const {provider,model,policy,corpus,queries}=input,candidate={providerId:provider.descriptor.id,model},base={candidate,suiteVersion:BENCHMARK_SUITE_VERSION,chunking:{id:policy.id,version:policy.version,digest:chunkingDigest(policy),productionReady:policy.productionReady},isolatedIndex:true as const,auditStatus:provider.descriptor.auditStatus}
  const registered=PROVIDERS.find((item)=>item.id===provider.descriptor.id),registeredModel=MODELS.find((item)=>item.id===model&&item.providerId===provider.descriptor.id)
  if(!registered||!registered.enabled)return{...base,status:'disabled',failure:'Provider is disabled by the canonical registry'}
  if(!registeredModel?.enabled)return{...base,status:'failed',failure:'Model is not registered for this provider'}
  const totalCharacters=[...corpus,...queries].reduce((sum,item)=>sum+item.text.length,0)
  if(!corpus.length||!queries.length||corpus.length>1_000||queries.length>200||totalCharacters>2_000_000)return{...base,status:'failed',failure:'Benchmark suite violates bounded size'}
  const deadline=performance.now()+Math.max(100,Math.min(input.timeoutMs??180_000,180_000))
  try{const info=await beforeDeadline(provider.modelInfo(model),deadline),rss=process.memoryUsage().rss,indexStart=performance.now(),chunks=corpus.flatMap((item)=>chunkText(item.text,policy).map((text)=>({topic:item.topic,text})));if(chunks.length>5_000)throw new Error('Benchmark chunk count exceeds the bounded limit');const vectors=await embedBatches(provider,model,chunks.map((item)=>item.text),deadline),indexMs=performance.now()-indexStart;if(vectors.length!==chunks.length||vectors.some((vector)=>!vector.length||vector.length>65_536||vector.some((value)=>!Number.isFinite(value))))throw new Error('Provider returned malformed vectors');const queryStart=performance.now(),queryVectors=await embedBatches(provider,model,queries.map((item)=>item.text),deadline),queryMs=performance.now()-queryStart;if(queryVectors.length!==queries.length||queryVectors.some((vector)=>vector.length!==vectors[0].length||vector.some((value)=>!Number.isFinite(value))))throw new Error('Provider returned malformed query vectors');let at1=0,at3=0,mrr=0;for(let q=0;q<queries.length;q++){const ranked=vectors.map((vector,index)=>({topic:chunks[index].topic,score:cosine(queryVectors[q],vector)})).sort((a,b)=>b.score-a.score),rank=ranked.findIndex((item)=>item.topic===queries[q].expectedTopic)+1;if(rank===1)at1++;if(rank>0&&rank<=3)at3++;if(rank)mrr+=1/rank}const dimensions=vectors[0].length,runtimeMemory=provider.runtimeMemoryMiB?await beforeDeadline(provider.runtimeMemoryMiB(model),deadline):null;return{...base,status:'complete',quality:{recallAt1:at1/queries.length,recallAt3:at3/queries.length,meanReciprocalRank:mrr/queries.length},performance:{indexMs:Math.round(indexMs),queryMs:Math.round(queryMs),documentsPerSecond:indexMs?Math.round(chunks.length/(indexMs/1000)):chunks.length,harnessRssDeltaMiB:Math.max(0,Math.round((process.memoryUsage().rss-rss)/1024/1024)),providerRuntimeMemoryMiB:runtimeMemory},provenance:{provider:provider.descriptor.id,providerVersion:provider.descriptor.version,model,modelDigest:info.digest,dimensions,chunkingPolicy:policy.id,chunkingVersion:policy.version,chunkingDigest:chunkingDigest(policy),suiteVersion:BENCHMARK_SUITE_VERSION},model:info}}
  catch(error){const message=error instanceof Error?error.message:'Embedding benchmark failed',unavailable=/not installed|unavailable|ECONNREFUSED|fetch failed/i.test(message);return{...base,status:unavailable?'unavailable':'failed',failure:message.slice(0,500)}}
}
export const QUALITY_GATE={recallAt1:.8,recallAt3:.95,meanReciprocalRank:.9} as const
export function recommendEmbedding(reports:BenchmarkReport[],availableMemoryGiB:number):BenchmarkReport|undefined{return reports.filter((report)=>{const model=MODELS.find((item)=>item.id===report.candidate.model&&item.providerId===report.candidate.providerId),memory=report.performance?.providerRuntimeMemoryMiB;return report.status==='complete'&&report.quality&&report.provenance&&report.chunking.productionReady&&report.candidate.providerId!=='fixture-local'&&report.quality.recallAt1>=QUALITY_GATE.recallAt1&&report.quality.recallAt3>=QUALITY_GATE.recallAt3&&report.quality.meanReciprocalRank>=QUALITY_GATE.meanReciprocalRank&&model&&availableMemoryGiB>=model.minimumMemoryGiB&&memory!==null&&memory!==undefined&&memory<=availableMemoryGiB*1024*.8}).sort((a,b)=>(b.quality!.meanReciprocalRank-a.quality!.meanReciprocalRank)||(b.quality!.recallAt3-a.quality!.recallAt3)||(a.performance!.queryMs-b.performance!.queryMs))[0]}

export interface EmbeddingWorkerDescriptor{deviceId:string;location:'local'|'trusted-peer';online:boolean;availableMemoryGiB:number;installedModels:string[];workspaceAllowed:boolean;userPreference:number}
export function selectEmbeddingWorker(input:{workers:EmbeddingWorkerDescriptor[];model:EmbeddingModelDescriptor;allowTrustedPeer:boolean;preferredDeviceId?:string}):EmbeddingWorkerDescriptor|undefined{return input.workers.filter((worker)=>worker.online&&worker.workspaceAllowed&&worker.availableMemoryGiB>=input.model.minimumMemoryGiB&&worker.installedModels.includes(input.model.id)&&(worker.location==='local'||input.allowTrustedPeer)).sort((left,right)=>Number(right.deviceId===input.preferredDeviceId)-Number(left.deviceId===input.preferredDeviceId)||right.userPreference-left.userPreference||Number(right.location==='local')-Number(left.location==='local'))[0]}

export class FixtureEmbeddingProvider implements BenchmarkProvider{
  descriptor=PROVIDERS[0]
  async modelInfo(){return{digest:'fixture-trigram-v1',sizeBytes:0,license:'Bundled test code'}}
  async embed(_model:string,inputs:string[]):Promise<number[][]>{return inputs.map((text)=>{const vector=Array(128).fill(0) as number[];for(const token of text.toLowerCase().match(/[a-z0-9]+/g)??[]){let hash=2166136261;for(const char of token){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}vector[(hash>>>0)%vector.length]++}return vector})}
}
