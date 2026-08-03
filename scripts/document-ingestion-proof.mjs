import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {extractDocumentOffMain} from '../dist-electron/electron/core/document-extraction-runner.js'

const root=mkdtempSync(path.join(tmpdir(),'waypoint-document-proof-'))
try{const file=path.join(root,'proof.md');writeFileSync(file,`# Waypoint\n\n${'Local document ingestion remains private. '.repeat(80)}`);const result=await extractDocumentOffMain(file,'text/markdown');if(result.status!=='extracted'||result.extractor!=='native-text'||result.chunks.length<2||result.chunks.some((chunk)=>result.text.slice(chunk.startOffset,chunk.endOffset)!==chunk.text))throw new Error('Compiled document worker proof failed');process.stdout.write(`Compiled document worker verified: chunks=${result.chunks.length}, extractor=${result.extractor}\n`)}finally{rmSync(root,{recursive:true,force:true})}
