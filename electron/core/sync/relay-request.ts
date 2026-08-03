import {createHash} from 'node:crypto'

const digest=(body:Uint8Array)=>createHash('sha256').update(body).digest('hex')
export const canonicalRelayRequest=(workspaceId:string,deviceId:string,keyEpoch:number,method:string,path:string,timestamp:string,nonce:string,body:Uint8Array)=>JSON.stringify([1,workspaceId,deviceId,keyEpoch,method.toUpperCase(),path,timestamp,nonce,digest(body)])
