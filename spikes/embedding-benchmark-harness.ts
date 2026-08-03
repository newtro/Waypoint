import { execFile } from 'node:child_process'
import {totalmem} from 'node:os'
import { promisify } from 'node:util'
import { corpus, queries, SUITE_VERSION } from './embedding-suite.js'
import {CHUNKING_POLICIES,FixtureEmbeddingProvider,MODELS,PROVIDERS,recommendEmbedding,runEmbeddingBenchmark,type BenchmarkReport} from '../electron/core/embedding-benchmark.js'
import {OllamaBenchmarkProvider} from '../electron/core/ollama.js'

const execFileAsync = promisify(execFile)
const requested = process.argv.slice(2)
const modelNames = requested.length ? requested : MODELS.filter((model)=>model.providerId==='ollama-local'&&model.enabled).map((model)=>model.id)

const reports:BenchmarkReport[]=[]
reports.push(await runEmbeddingBenchmark({provider:new FixtureEmbeddingProvider(),model:'fixture-trigram-v1',policy:CHUNKING_POLICIES[0],corpus,queries}))
try{
  const { stdout } = await execFileAsync('ollama', ['--version'], { timeout: 5_000 })
  const provider=new OllamaBenchmarkProvider(stdout.trim())
  for(const model of modelNames)for(const policy of CHUNKING_POLICIES)reports.push(await runEmbeddingBenchmark({provider,model,policy,corpus,queries}))
}catch(error){
  const failure=error instanceof Error?error.message:'Ollama unavailable'
  for(const model of modelNames)reports.push({status:'unavailable',candidate:{providerId:'ollama-local',model},suiteVersion:SUITE_VERSION,chunking:{id:CHUNKING_POLICIES[0].id,version:CHUNKING_POLICIES[0].version,digest:'not-run',productionReady:true},isolatedIndex:true,auditStatus:PROVIDERS[1].auditStatus,failure:failure.slice(0,500)})
}
const availableMemoryGiB=Math.floor(totalmem()/1024/1024/1024),recommendation=recommendEmbedding(reports,availableMemoryGiB)
console.log(JSON.stringify({formatVersion:1,suiteVersion:SUITE_VERSION,isolatedIndex:true,availableMemoryGiB,automaticCandidates:modelNames,reports,recommendation:recommendation?.provenance??null,recommendationReason:recommendation?'Passed quality, registered model minimum-memory, measured runtime-memory, and production chunking gates; ranked by MRR, recall@3, then query latency.':'No audited production candidate passed quality plus measured memory gates; keep the current index and do not imply a default.',disabledProviders:PROVIDERS.filter((provider)=>!provider.enabled)},null,2))
