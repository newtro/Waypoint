import { describe,expect,it } from 'vitest'
import { missingRelativeImports } from './package-runtime-closure.js'

describe('packaged runtime import closure',()=>{
  it('detects the packaged-only missing module that prevents main-process startup',()=>{
    const files=new Map([['/dist-electron/electron/main.js',"import { detectCli } from '../spikes/cli-capabilities.js'\n"]])
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!)).toEqual(['/dist-electron/electron/main.js -> /dist-electron/spikes/cli-capabilities.js'])
    files.set('/dist-electron/spikes/cli-capabilities.js','export const detectCli=()=>undefined')
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!)).toEqual([])
  })
})
