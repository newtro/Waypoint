import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import { verifyBrowserClosure } from '../electron/core/agent-browser.js'
import { loadProductHelp } from '../electron/core/product-help.js'

const relativeImport=/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g
const relativeRuntimeUrl=/\bnew\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g
const relativeDynamicImport=/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
const relativeRequire=/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
const runtimeRoots=['/dist-electron/electron/main.js','/dist-electron/electron/preload.cjs','/dist-electron/electron/core/fast-local-speech-worker.js','/dist-electron/electron/core/fast-local-transcription-worker.js'] as const

export function missingRelativeImports(entries:readonly string[],read:(entry:string)=>string,entry='/dist-electron/electron/main.js',additionalRoots:readonly string[]=[]):string[]{
  const available=new Set(entries),visited=new Set<string>(),missing:string[]=[],pending=[entry,...additionalRoots]
  while(pending.length){const current=pending.pop()!;if(visited.has(current))continue;visited.add(current);if(!available.has(current)){missing.push(current);continue}
    const source=read(current);for(const pattern of[relativeImport,relativeRuntimeUrl,relativeDynamicImport,relativeRequire])for(const match of source.matchAll(pattern)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(current),match[1]));const resolved=path.posix.extname(target)?target:`${target}.js`;if(!available.has(resolved))missing.push(`${current} -> ${resolved}`);else if(resolved.endsWith('.js')||resolved.endsWith('.cjs'))pending.push(resolved)}
  }
  return [...new Set(missing)]
}

export function verifyPackagedRuntime(archive:string):void{
  if(!existsSync(archive))throw new Error(`Packaged archive not found: ${archive}`)
  const listed=listPackage(archive),originalByNormalized=new Map(listed.map((entry)=>[entry.replaceAll('\\','/'),entry])),entries=[...originalByNormalized.keys()],missing=missingRelativeImports(entries,(entry)=>extractFile(archive,originalByNormalized.get(entry)!.slice(1)).toString('utf8'),runtimeRoots[0],runtimeRoots.slice(1))
  if(missing.length)throw new Error(`Packaged main-process runtime has missing relative imports:\n${missing.join('\n')}`)
}

export function verifyPackagedProductHelp(resources:string):void{
  const library=loadProductHelp(path.join(resources,'waypoint-help'))
  if(library.documents.length<8||!/^\d{4}\.\d{2}\.\d{2}\./.test(library.helpVersion))throw new Error('Packaged Waypoint Help coverage/version is invalid')
}

export function validPackagedFastLocalMetric(measured:{firstPlayableAudioMs:number;samples:number;sampleRate:number}):boolean{
  return Number.isFinite(measured.firstPlayableAudioMs)&&measured.firstPlayableAudioMs>=0&&measured.firstPlayableAudioMs<=1000&&Number.isInteger(measured.samples)&&measured.samples>0&&measured.sampleRate===24000
}

const voiceFiles={
  'bin/waypoint-whisper':'f74342a44a2addfafcfd30ba74f8bbdeef4044d82f530ae58f49fc20e6d79b4a',
  'Frameworks/whisper.framework/Versions/A/whisper':'9664726a3ecf1d9fdadcbc731b9dba3b5bbeea184d42797e044a347c2b7c8ea5',
  'ggml-base.en-q5_1.bin':'4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
} as const
const fastVoiceFiles={
  'model.fp16.onnx':'6b42d25df767db408d95738b464f02168a9cfb76367c1b2b9e90095485981407',
  'voices.bin':'138cf3a7afd0ebf1f9d6fb72f49e960ef8405252eaff5d130cf3fba1b038a741',
  'tokens.txt':'934a4188addc7665dd3410256bb622169242357fbb99d840d9351209b486dabb',
  'LICENSE':'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
}as const
const fastAsrFiles={
  'tiny.en-decoder.int8.onnx':'06c0e6ff6348d427e51839219d1c886c18cfdf411e629e33f5e1679bff9c1527',
  'tiny.en-encoder.int8.onnx':'0ce578b827c94a961aacb8fa14b02f096504b337e5c94be37c36238cbe3e8bc6',
  'tiny.en-tokens.txt':'306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930',
  'LICENSE':'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d',
}as const
function verifyPackagedFastLocal(resources:string,executable:string,archive:string):void{
  for(const[relative,expected]of Object.entries(fastVoiceFiles)){const file=path.join(resources,'fast-local/kitten',relative);accessSync(file,constants.R_OK);if(!statSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==expected)throw new Error(`Packaged Fast Local resource digest mismatch: ${relative}`)}
  for(const[relative,expected]of Object.entries(fastAsrFiles)){const file=path.join(resources,'fast-local/whisper-tiny.en',relative);accessSync(file,constants.R_OK);if(!statSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==expected)throw new Error(`Packaged Fast Local ASR resource digest mismatch: ${relative}`)}
  const provenance=JSON.parse(readFileSync(path.join(resources,'fast-local/kitten/WAYPOINT-PROVENANCE.json'),'utf8'))as{engine?:string;model?:{license?:string}};if(provenance.engine!=='fast_local'||provenance.model?.license!=='Apache-2.0')throw new Error('Packaged Fast Local provenance is invalid')
  const environment={ELECTRON_RUN_AS_NODE:'1',PATH:process.env.PATH??''},probe=execFileSync(executable,['-e',`const s=require(${JSON.stringify(`${archive}/node_modules/sherpa-onnx-node`)});if(!s.OfflineTts)process.exit(2)`],{encoding:'utf8',timeout:10_000,maxBuffer:256*1024,env:environment});if(probe.trim())throw new Error('Packaged sherpa runtime probe emitted unexpected output')
  const modelRoot=path.join(resources,'fast-local/kitten'),benchmark=execFileSync(executable,['-e',`const p=require('node:path'),s=require(${JSON.stringify(`${archive}/node_modules/sherpa-onnx-node`)}),r=${JSON.stringify(modelRoot)};(async()=>{const t=await s.OfflineTts.createAsync({model:{kitten:{model:p.join(r,'model.fp16.onnx'),voices:p.join(r,'voices.bin'),tokens:p.join(r,'tokens.txt'),dataDir:p.join(r,'espeak-ng-data')}},maxNumSentences:1,numThreads:2,provider:'cpu'}),started=performance.now();let firstPlayableAudioMs,streamedSamples=0;const out=await t.generateAsync({text:'Waypoint is ready to help. This is the packaged Fast Local voice benchmark.',sid:0,speed:1,enableExternalBuffer:false,onProgress:(chunk)=>{if(chunk.samples.length){firstPlayableAudioMs??=performance.now()-started;streamedSamples+=chunk.samples.length}return true}}),samples=streamedSamples||out.samples.length;if(firstPlayableAudioMs===undefined&&out.samples.length)firstPlayableAudioMs=performance.now()-started;if(!samples||out.sampleRate!==24000||firstPlayableAudioMs===undefined)process.exit(3);console.log(JSON.stringify({firstPlayableAudioMs,samples,sampleRate:out.sampleRate}))})()`],{encoding:'utf8',timeout:20_000,maxBuffer:256*1024,env:environment});const measured=JSON.parse(benchmark.trim())as{firstPlayableAudioMs:number;samples:number;sampleRate:number};if(!validPackagedFastLocalMetric(measured))throw new Error(`Packaged Fast Local latency gate failed: ${JSON.stringify(measured)}`)
  const asrRoot=path.join(resources,'fast-local/whisper-tiny.en');execFileSync(executable,['-e',`const p=require('node:path'),s=require(${JSON.stringify(`${archive}/node_modules/sherpa-onnx-node`)}),r=${JSON.stringify(asrRoot)};(async()=>{await s.OfflineRecognizer.createAsync({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{whisper:{encoder:p.join(r,'tiny.en-encoder.int8.onnx'),decoder:p.join(r,'tiny.en-decoder.int8.onnx'),language:'en',task:'transcribe'},tokens:p.join(r,'tiny.en-tokens.txt'),numThreads:2,provider:'cpu'}})})()`],{encoding:'utf8',timeout:20_000,maxBuffer:256*1024,env:environment})
}

export function verifyPackagedVoice(resources:string):void{
  for(const [relative,expected] of Object.entries(voiceFiles)){
    const file=path.join(resources,'voice',relative);accessSync(file,constants.R_OK);if(relative.startsWith('bin/'))accessSync(file,constants.X_OK)
    if(!statSync(file).isFile())throw new Error(`Packaged voice resource is not a file: ${relative}`)
    const actual=createHash('sha256').update(readFileSync(file)).digest('hex');if(actual!==expected)throw new Error(`Packaged voice resource digest mismatch: ${relative}`)
  }
  const current=path.join(resources,'voice/Frameworks/whisper.framework/Versions/Current');if(path.basename(realpathSync(current))!=='A')throw new Error('Packaged whisper framework Current link is invalid')
  const helper=path.join(resources,'voice/bin/waypoint-whisper'),help=execFileSync(helper,['--help'],{encoding:'utf8',timeout:10_000,maxBuffer:256*1024});if(!/whisper/i.test(help))throw new Error('Packaged voice helper could not load its framework')
  const archive=path.join(resources,'app.asar'),executable=path.resolve(resources,'../MacOS/Waypoint');verifyPackagedFastLocal(resources,executable,archive)
}

export function verifyPackagedWindowsResources(resources:string):void{
  const archive=path.join(resources,'app.asar'),executable=path.resolve(resources,'../Waypoint.exe')
  verifyBrowserClosure(path.join(resources,'agent-browser'))
  verifyPackagedFastLocal(resources,executable,archive)
}

if(process.argv[1]&&path.resolve(fileURLToPath(import.meta.url))===path.resolve(process.argv[1])){
  const here=path.dirname(fileURLToPath(import.meta.url)),archive=process.argv[2]??(process.platform==='win32'?path.resolve(here,'../release/win-unpacked/resources/app.asar'):path.resolve(here,'../release/mac-arm64/Waypoint.app/Contents/Resources/app.asar')),resources=path.dirname(archive)
  verifyPackagedRuntime(archive);verifyPackagedProductHelp(resources);if(process.platform==='win32')verifyPackagedWindowsResources(resources);else verifyPackagedVoice(resources);console.log(`Packaged runtime and platform resource closure verified: ${archive}`)
}
