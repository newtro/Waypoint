import {createHash} from 'node:crypto'
import {sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {TextItem} from 'pdfjs-dist/types/src/display/api.js'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth'
import {chunkingDigest,type ChunkingPolicy} from './embedding-benchmark.js'

export const DOCUMENT_EXTRACTION_VERSION='local-documents-v1'
export const DOCUMENT_CHUNKING_POLICY:ChunkingPolicy={id:'document-sentence-window',version:'1',kind:'sentence',maxCharacters:1_200,overlapCharacters:120,productionReady:true}
export const DOCUMENT_LIMITS={maxBytes:25*1024*1024,maxPages:500,maxCharacters:2_000_000,maxChunks:2_000,timeoutMs:120_000} as const
const PDF_STANDARD_FONT_DATA_URL=`${fileURLToPath(new URL('./standard_fonts/',import.meta.resolve('pdfjs-dist/package.json')))}${sep}`
export type ExtractedDocument={text:string;extractor:string;extractorVersion:string;pages?:number;warnings:string[]}
export type DocumentChunk={index:number;startOffset:number;endOffset:number;text:string;textDigest:string;policy:string;policyVersion:string;policyDigest:string}

function bounded(text:string):string{const value=text.replaceAll('\u0000','').replace(/\r\n?/g,'\n').trim();if(!value)throw new Error('The selected document contains no extractable text');if(value.length>DOCUMENT_LIMITS.maxCharacters)throw new Error('Extracted document text exceeds the local limit');return value}
function withDeadline<T>(operation:Promise<T>):Promise<T>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Local document extraction timed out')),DOCUMENT_LIMITS.timeoutMs);operation.then((value)=>{clearTimeout(timer);resolve(value)},(error)=>{clearTimeout(timer);reject(error)})})}

export async function extractDocument(bytes:Uint8Array,mediaType:string):Promise<ExtractedDocument>{
  if(!bytes.byteLength||bytes.byteLength>DOCUMENT_LIMITS.maxBytes)throw new Error('Document violates the local file-size limit')
  if(mediaType==='text/plain'||mediaType==='text/markdown'){let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new Error('Text documents must be valid UTF-8')}return{text:bounded(text),extractor:'native-text',extractorVersion:DOCUMENT_EXTRACTION_VERSION,warnings:[]}}
  if(mediaType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
    const result=await withDeadline(mammoth.extractRawText({buffer:Buffer.from(bytes)}));return{text:bounded(result.value),extractor:'mammoth',extractorVersion:'1.12.0',warnings:result.messages.slice(0,20).map((item)=>String(item.message).slice(0,300))}
  }
  if(mediaType==='application/pdf'){
    const task=getDocument({data:Uint8Array.from(bytes),standardFontDataUrl:PDF_STANDARD_FONT_DATA_URL}),document=await withDeadline(task.promise)
    try{if(document.numPages>DOCUMENT_LIMITS.maxPages)throw new Error('PDF exceeds the local page limit');const pages:string[]=[];for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){const page=await withDeadline(document.getPage(pageNumber)),content=await withDeadline(page.getTextContent()),text=content.items.filter((item):item is TextItem=>'str'in item).map((item)=>item.str).join(' ');pages.push(text);if(pages.reduce((sum,item)=>sum+item.length,0)>DOCUMENT_LIMITS.maxCharacters)throw new Error('Extracted document text exceeds the local limit')}return{text:bounded(pages.join('\n\n')),extractor:'pdfjs',extractorVersion:'6.2.108',pages:document.numPages,warnings:[]}}finally{await task.destroy()}
  }
  throw new Error('This file type has no approved local text extractor')
}

export function chunkExtractedText(text:string):DocumentChunk[]{
  const policy=DOCUMENT_CHUNKING_POLICY,digest=chunkingDigest(policy),chunks:DocumentChunk[]=[];let start=0
  while(start<text.length){let end=Math.min(text.length,start+policy.maxCharacters);if(end<text.length){const boundary=Math.max(text.lastIndexOf('\n',end),text.lastIndexOf(' ',end));if(boundary>start+Math.floor(policy.maxCharacters/2))end=boundary}const value=text.slice(start,end).trim(),leading=text.slice(start,end).indexOf(value);if(value){const exactStart=start+Math.max(0,leading),exactEnd=exactStart+value.length;chunks.push({index:chunks.length,startOffset:exactStart,endOffset:exactEnd,text:value,textDigest:createHash('sha256').update(value).digest('hex'),policy:policy.id,policyVersion:policy.version,policyDigest:digest})}if(chunks.length>DOCUMENT_LIMITS.maxChunks)throw new Error('Document exceeds the local chunk-count limit');if(end>=text.length)break;start=Math.max(start+1,end-policy.overlapCharacters)}
  return chunks
}
