import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'

const relativeImport=/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g

export function missingRelativeImports(entries:readonly string[],read:(entry:string)=>string,entry='/dist-electron/electron/main.js'):string[]{
  const available=new Set(entries),visited=new Set<string>(),missing:string[]=[],pending=[entry]
  while(pending.length){const current=pending.pop()!;if(visited.has(current))continue;visited.add(current);if(!available.has(current)){missing.push(current);continue}
    for(const match of read(current).matchAll(relativeImport)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(current),match[1]));const resolved=path.posix.extname(target)?target:`${target}.js`;if(!available.has(resolved))missing.push(`${current} -> ${resolved}`);else if(resolved.endsWith('.js'))pending.push(resolved)}
  }
  return [...new Set(missing)]
}

export function verifyPackagedRuntime(archive:string):void{
  if(!existsSync(archive))throw new Error(`Packaged archive not found: ${archive}`)
  const entries=listPackage(archive),missing=missingRelativeImports(entries,(entry)=>extractFile(archive,entry.slice(1)).toString('utf8'))
  if(missing.length)throw new Error(`Packaged main-process runtime has missing relative imports:\n${missing.join('\n')}`)
}

const voiceFiles={
  'bin/waypoint-whisper':'f74342a44a2addfafcfd30ba74f8bbdeef4044d82f530ae58f49fc20e6d79b4a',
  'Frameworks/whisper.framework/Versions/A/whisper':'9664726a3ecf1d9fdadcbc731b9dba3b5bbeea184d42797e044a347c2b7c8ea5',
  'ggml-base.en-q5_1.bin':'4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
} as const
export function verifyPackagedVoice(resources:string):void{
  for(const [relative,expected] of Object.entries(voiceFiles)){
    const file=path.join(resources,'voice',relative);accessSync(file,constants.R_OK);if(relative.startsWith('bin/'))accessSync(file,constants.X_OK)
    if(!statSync(file).isFile())throw new Error(`Packaged voice resource is not a file: ${relative}`)
    const actual=createHash('sha256').update(readFileSync(file)).digest('hex');if(actual!==expected)throw new Error(`Packaged voice resource digest mismatch: ${relative}`)
  }
  const current=path.join(resources,'voice/Frameworks/whisper.framework/Versions/Current');if(path.basename(realpathSync(current))!=='A')throw new Error('Packaged whisper framework Current link is invalid')
  const helper=path.join(resources,'voice/bin/waypoint-whisper'),help=execFileSync(helper,['--help'],{encoding:'utf8',timeout:10_000,maxBuffer:256*1024});if(!/whisper/i.test(help))throw new Error('Packaged voice helper could not load its framework')
}

if(import.meta.url===`file://${process.argv[1]}`){
  const here=path.dirname(fileURLToPath(import.meta.url)),archive=process.argv[2]??path.resolve(here,'../release/mac-arm64/Waypoint.app/Contents/Resources/app.asar')
  verifyPackagedRuntime(archive);verifyPackagedVoice(path.dirname(archive));console.log(`Packaged runtime and bundled voice closure verified: ${archive}`)
}
