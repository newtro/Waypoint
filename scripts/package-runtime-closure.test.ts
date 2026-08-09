import { describe,expect,it } from 'vitest'
import { fastSpeechSegments } from '../electron/core/fast-local-speech.js'
import { missingRelativeImports,packagedFastLocalOpening,packagedFastLocalResponse,validPackagedFastLocalMetric } from './package-runtime-closure.js'

describe('packaged runtime import closure',()=>{
  it('detects the packaged-only missing module that prevents main-process startup',()=>{
    const files=new Map([['/dist-electron/electron/main.js',"import { detectCli } from '../spikes/cli-capabilities.js'\n"]])
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!)).toEqual(['/dist-electron/electron/main.js -> /dist-electron/spikes/cli-capabilities.js'])
    files.set('/dist-electron/spikes/cli-capabilities.js','export const detectCli=()=>undefined')
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!)).toEqual([])
  })
  it('requires preload, computed voice workers, and import-meta worker URLs',()=>{
    const main='/dist-electron/electron/main.js',preload='/dist-electron/electron/preload.cjs',speech='/dist-electron/electron/core/fast-local-speech-worker.js',transcription='/dist-electron/electron/core/fast-local-transcription-worker.js',runner='/dist-electron/electron/core/runner.js',worker='/dist-electron/electron/core/worker.js',files=new Map([[main,"import './core/runner.js'"],[runner,"new Worker(new URL('./worker.js', import.meta.url))"]])
    const roots=[preload,speech,transcription]
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!,main,roots)).toEqual(expect.arrayContaining([preload,speech,transcription,`${runner} -> ${worker}`]))
    for(const file of[preload,speech,transcription,worker])files.set(file,'')
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!,main,roots)).toEqual([])
  })
  it('follows literal dynamic imports and relative CommonJS requires',()=>{
    const main='/dist-electron/electron/main.js',lazy='/dist-electron/electron/lazy.js',required='/dist-electron/electron/required.cjs',files=new Map([[main,"void import('./lazy.js'); require('./required.cjs')"]])
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!,main)).toEqual(expect.arrayContaining([`${main} -> ${lazy}`,`${main} -> ${required}`]))
    files.set(lazy,'');files.set(required,'')
    expect(missingRelativeImports([...files.keys()],(entry)=>files.get(entry)!,main)).toEqual([])
  })
})

describe('packaged Fast Local metric',()=>{
  it('measures the same bounded opening segment that production plays first',()=>{
    expect(packagedFastLocalOpening).toBe('Waypoint is ready to help.')
    expect(fastSpeechSegments(packagedFastLocalResponse)[0]).toBe(packagedFastLocalOpening)
    expect(fastSpeechSegments(packagedFastLocalResponse).length).toBeGreaterThan(1)
    expect(packagedFastLocalOpening.length).toBeLessThanOrEqual(80)
    expect(packagedFastLocalOpening).toMatch(/[.!?]$/)
  })
  it('accepts only playable 24 kHz streaming audio inside the first-audio budget',()=>{
    expect(validPackagedFastLocalMetric({firstPlayableAudioMs:999,samples:2400,sampleRate:24000})).toBe(true)
    expect(validPackagedFastLocalMetric({firstPlayableAudioMs:1001,samples:2400,sampleRate:24000})).toBe(false)
    expect(validPackagedFastLocalMetric({firstPlayableAudioMs:200,samples:0,sampleRate:24000})).toBe(false)
    expect(validPackagedFastLocalMetric({firstPlayableAudioMs:200,samples:2400,sampleRate:16000})).toBe(false)
  })
})
