import {createHash} from 'node:crypto'
export interface WebhookEnvelope{version:1;eventId:string;ciphertextBase64:string}
const digest=(body:Uint8Array)=>createHash('sha256').update(body).digest('hex')
export const canonicalWebhookRequest=(channelId:string,secretVersion:number,path:string,timestamp:string,nonce:string,body:Uint8Array)=>JSON.stringify([1,channelId,secretVersion,'POST',path,timestamp,nonce,digest(body)])
