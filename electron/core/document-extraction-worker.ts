import {parentPort,workerData} from 'node:worker_threads'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {extractDocument,chunkExtractedText} from './document-ingestion.js'
import {validateAttachment} from './chat-attachments.js'

const request=workerData as {filePath?:unknown;mediaType?:unknown}
try{if(!parentPort||typeof request.filePath!=='string'||!path.isAbsolute(request.filePath)||typeof request.mediaType!=='string')throw new Error('Invalid extraction request');const bytes=readFileSync(request.filePath),validated=validateAttachment(path.basename(request.filePath),request.mediaType,bytes),extracted=await extractDocument(bytes,request.mediaType),chunks=chunkExtractedText(extracted.text);parentPort.postMessage({status:'extracted',fileName:validated.safeName,mediaType:request.mediaType,sourceDigest:createHash('sha256').update(bytes).digest('hex'),...extracted,chunks})}catch{parentPort?.postMessage({status:'failed',code:'extraction_failed'})}
