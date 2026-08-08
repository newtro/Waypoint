import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AttachmentMetadata } from './types.js'

export type { AttachmentMetadata } from './types.js'

export const MAX_ATTACHMENT_BYTES=25*1024*1024
export const MAX_ATTACHMENTS_PER_OWNER=20
export const MAX_ATTACHMENTS_PER_WORKSPACE=500

export const ATTACHMENT_MEDIA_BY_EXTENSION:Readonly<Record<string,string>>={
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt':'text/plain','.md':'text/markdown','.markdown':'text/markdown',
}
export const SUPPORTED_ATTACHMENT_MEDIA_TYPES=new Set(Object.values(ATTACHMENT_MEDIA_BY_EXTENSION))
export const MAX_IMAGE_PIXELS=40_000_000

export function imageDimensions(mediaType:string,bytes:Uint8Array):{width:number;height:number}{
  const buffer=Buffer.from(bytes);let width=0,height=0
  if(mediaType==='image/png'&&buffer.length>=24){width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20)}
  else if(mediaType==='image/gif'&&buffer.length>=10){width=buffer.readUInt16LE(6);height=buffer.readUInt16LE(8)}
  else if(mediaType==='image/jpeg'){let offset=2;while(offset+8<buffer.length){if(buffer[offset]!==0xff){offset++;continue}const marker=buffer[offset+1],length=buffer.readUInt16BE(offset+2);if(length<2)break;if((marker>=0xc0&&marker<=0xc3)||(marker>=0xc5&&marker<=0xc7)||(marker>=0xc9&&marker<=0xcb)||(marker>=0xcd&&marker<=0xcf)){height=buffer.readUInt16BE(offset+5);width=buffer.readUInt16BE(offset+7);break}offset+=2+length}}
  else if(mediaType==='image/webp'&&buffer.length>=30){const kind=buffer.toString('ascii',12,16);if(kind==='VP8X'){width=1+buffer.readUIntLE(24,3);height=1+buffer.readUIntLE(27,3)}else if(kind==='VP8 '&&buffer.length>=30){width=buffer.readUInt16LE(26)&0x3fff;height=buffer.readUInt16LE(28)&0x3fff}else if(kind==='VP8L'&&buffer.length>=25&&buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1}}
  if(width<1||height<1||width>16384||height>16384||width*height>MAX_IMAGE_PIXELS)throw new Error('Image dimensions are invalid or exceed the safe preview limit')
  return{width,height}
}

function starts(bytes:Uint8Array,signature:number[]):boolean{return signature.every((value,index)=>bytes[index]===value)}
function validateSignature(mediaType:string,bytes:Uint8Array):void{
  const valid=mediaType==='image/png'?starts(bytes,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
    :mediaType==='image/jpeg'?starts(bytes,[0xff,0xd8,0xff])
      :mediaType==='image/gif'?Buffer.from(bytes.slice(0,6)).toString('ascii')==='GIF87a'||Buffer.from(bytes.slice(0,6)).toString('ascii')==='GIF89a'
        :mediaType==='image/webp'?Buffer.from(bytes.slice(0,4)).toString('ascii')==='RIFF'&&Buffer.from(bytes.slice(8,12)).toString('ascii')==='WEBP'
          :mediaType==='application/pdf'?Buffer.from(bytes.slice(0,5)).toString('ascii')==='%PDF-'
            :mediaType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'?starts(bytes,[0x50,0x4b,0x03,0x04])&&Buffer.from(bytes).includes(Buffer.from('[Content_Types].xml'))&&Buffer.from(bytes).includes(Buffer.from('word/'))
              :true
  if(!valid)throw new Error('Attachment content signature does not match its declared type')
  if(mediaType==='text/plain'||mediaType==='text/markdown'){
    if(bytes.includes(0))throw new Error('Text attachments cannot contain NUL bytes')
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new Error('Text attachments must be valid UTF-8')}
  }
}

export function validateAttachment(name:string,mediaType:string,bytes:Uint8Array):{safeName:string;bytes:number;sha256:string}{
  const safeName=path.posix.basename(name.replaceAll('\\','/')).trim(),extension=path.extname(safeName).toLowerCase()
  if(!safeName||safeName.length>240)throw new Error('Attachment filename is invalid')
  const expected=ATTACHMENT_MEDIA_BY_EXTENSION[extension]
  if(!expected||expected!==mediaType||!SUPPORTED_ATTACHMENT_MEDIA_TYPES.has(mediaType))throw new Error('Attachment extension and MIME type are not an allowed pair')
  if(bytes.byteLength<1||bytes.byteLength>MAX_ATTACHMENT_BYTES)throw new Error(`Attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes`)
  validateSignature(mediaType,bytes)
  return{safeName,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}
}

export function readAndValidateAttachment(sourcePath:string,name:string,mediaType:string):{safeName:string;bytes:Buffer;sha256:string}{
  const stat=statSync(sourcePath)
  if(!stat.isFile()||stat.size<1||stat.size>MAX_ATTACHMENT_BYTES)throw new Error(`Attachment must be a regular file no larger than ${MAX_ATTACHMENT_BYTES} bytes`)
  const bytes=readFileSync(sourcePath),validated=validateAttachment(name,mediaType,bytes)
  return{safeName:validated.safeName,bytes,sha256:validated.sha256}
}

export type ProviderAttachmentPreparation=
  |{kind:'text';text:string;mediaType:string;sha256:string;sourceAttachmentId:string}
  |{kind:'path';path:string;mediaType:string;sha256:string;sourceAttachmentId:string}
  |{kind:'unsupported';reason:string;sourceAttachmentId:string}

export function prepareAttachmentForProvider(input:{metadata:AttachmentMetadata;absolutePath:string;capabilities:{inlineText:boolean;filePaths:boolean;acceptedMediaTypes:readonly string[];maxBytes:number}}):ProviderAttachmentPreparation{
  const {metadata,absolutePath,capabilities}=input
  if(metadata.bytes>capabilities.maxBytes)return{kind:'unsupported',reason:'Attachment exceeds the selected provider capability limit',sourceAttachmentId:metadata.id}
  if(!capabilities.acceptedMediaTypes.includes(metadata.mediaType))return{kind:'unsupported',reason:`The selected provider does not accept ${metadata.mediaType}`,sourceAttachmentId:metadata.id}
  const bytes=readFileSync(absolutePath),digest=createHash('sha256').update(bytes).digest('hex')
  if(bytes.byteLength!==metadata.bytes||digest!==metadata.sha256)throw new Error('Stored attachment integrity check failed')
  validateAttachment(metadata.name,metadata.mediaType,bytes)
  if((metadata.mediaType==='text/plain'||metadata.mediaType==='text/markdown')&&capabilities.inlineText)return{kind:'text',text:new TextDecoder().decode(bytes),mediaType:metadata.mediaType,sha256:digest,sourceAttachmentId:metadata.id}
  if(capabilities.filePaths)return{kind:'path',path:absolutePath,mediaType:metadata.mediaType,sha256:digest,sourceAttachmentId:metadata.id}
  return{kind:'unsupported',reason:'The selected CLI adapter cannot deliver this attachment without unsupported parsing',sourceAttachmentId:metadata.id}
}
