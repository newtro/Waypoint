import { existsSync } from 'node:fs'
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

if(import.meta.url===`file://${process.argv[1]}`){
  const here=path.dirname(fileURLToPath(import.meta.url)),archive=process.argv[2]??path.resolve(here,'../release/mac-arm64/Waypoint.app/Contents/Resources/app.asar')
  verifyPackagedRuntime(archive);console.log(`Packaged runtime import closure verified: ${archive}`)
}
