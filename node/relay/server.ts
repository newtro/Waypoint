import {readFileSync} from 'node:fs'
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import type {Server} from 'node:http'
import type {RelayConfig} from './config.js'
import {DurableOpaqueRelayService} from './durable-service.js'
import {RelayAuthorityStore} from './authority-store.js'
import type {EnrollmentApproval,EnrollmentConsumeProof,EnrollmentInvitation,EnrollmentRequest,RotationClaimProof} from '../../electron/core/sync/types.js'
import type {OpaqueRelayMessage} from './types.js'
import {canonicalRelayRequest} from '../../electron/core/sync/relay-request.js'
export {canonicalRelayRequest} from '../../electron/core/sync/relay-request.js'

const MAX_BODY=9*1024*1024,ID=/^[A-Za-z0-9_-]{16,128}$/
async function readBody(request:IncomingMessage):Promise<Buffer>{const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const value=Buffer.from(chunk);size+=value.length;if(size>MAX_BODY)throw new Error('request_too_large');chunks.push(value)}return Buffer.concat(chunks)}
const json=(response:ServerResponse,status:number,value:unknown)=>{const body=JSON.stringify(value);response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});response.end(body)}
const allowed=(buckets:Map<string,{start:number;count:number}>,key:string,now:number,limit:number)=>{if(buckets.size>10_000)for(const [candidate,bucket] of buckets)if(now-bucket.start>=60_000)buckets.delete(candidate);const bucket=buckets.get(key);if(!bucket||now-bucket.start>=60_000){buckets.set(key,{start:now,count:1});return true}bucket.count++;return bucket.count<=limit}

export async function createRelayServer(config:RelayConfig):Promise<{server:Server;relay:DurableOpaqueRelayService}>{
  const authority=await RelayAuthorityStore.open(config.databasePath),seed=JSON.parse(readFileSync(config.authorityRegistryPath,'utf8')) as {version?:unknown;workspaces?:Array<{workspaceId:string;keyEpoch:number;devices:Array<{deviceId:string;signingPublicKey:string;encryptionPublicKey:string;role:'owner'|'peer';active:boolean}>}>};if(seed.version!==1||!Array.isArray(seed.workspaces))throw new Error('Unsupported relay authority registry');for(const workspace of seed.workspaces)authority.seedWorkspace(workspace.workspaceId,workspace.keyEpoch,workspace.devices)
  const relay=new DurableOpaqueRelayService(config.databasePath,authority),principals=new Map<string,{start:number;count:number}>(),global=new Map<string,{start:number;count:number}>(),healthRate=new Map<string,{start:number;count:number}>();let inFlight=0,cachedHealth=relay.health();const healthTimer=setInterval(()=>{cachedHealth=relay.health()},60_000);healthTimer.unref()
  const server=createServer(async(request,response)=>{
    const started=Date.now();if(!allowed(global,'proxy-loopback',started,6000)){json(response,429,{error:'rate_limited'});return}if(inFlight>=64){json(response,503,{error:'busy'});return}inFlight++
    try{
      const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`),method=request.method??'GET'
      if(method==='GET'&&url.pathname==='/v1/health'){if(!allowed(healthRate,'public-health',started,60)){json(response,429,{error:'rate_limited'});return}json(response,cachedHealth.status==='ok'?200:503,{status:cachedHealth.status,protocolVersion:cachedHealth.protocolVersion});return}
      const body=method==='GET'?Buffer.alloc(0):await readBody(request)
      if(method==='POST'&&url.pathname==='/v1/enrollments/submit'){const value=JSON.parse(body.toString('utf8')) as {invitationId:string;secret:string;request:EnrollmentRequest};json(response,202,authority.submitEnrollment(value.invitationId,value.secret,value.request));return}
      if(method==='POST'&&url.pathname==='/v1/enrollments/approval'){const value=JSON.parse(body.toString('utf8')) as {requestId:string},approval=authority.enrollmentApproval(String(value.requestId));json(response,approval?200:404,approval?{approval}:{error:'approval_unavailable'});return}
      if(method==='POST'&&url.pathname==='/v1/enrollments/consume'){const value=JSON.parse(body.toString('utf8')) as {proof:EnrollmentConsumeProof};json(response,200,authority.consumeApproval(value.proof));return}
      if(method==='POST'&&url.pathname==='/v1/rotations/claim'){const value=JSON.parse(body.toString('utf8')) as {proof:RotationClaimProof};try{json(response,200,authority.claimRotation(value.proof))}catch{json(response,404,{error:'rotation_unavailable'})}return}
      const workspaceId=String(request.headers['x-waypoint-workspace']??''),deviceId=String(request.headers['x-waypoint-device']??''),keyEpoch=Number(request.headers['x-waypoint-epoch']),timestamp=String(request.headers['x-waypoint-timestamp']??''),nonce=String(request.headers['x-waypoint-nonce']??''),signature=String(request.headers['x-waypoint-signature']??''),requestTime=Date.parse(timestamp),requestPath=`${url.pathname}${url.search}`
      if(!ID.test(workspaceId)||!ID.test(deviceId)||!ID.test(nonce)||!Number.isSafeInteger(keyEpoch)||!Number.isFinite(requestTime)||Math.abs(started-requestTime)>60_000||!authority.verifyRequest(workspaceId,deviceId,keyEpoch,canonicalRelayRequest(workspaceId,deviceId,keyEpoch,method,requestPath,timestamp,nonce,body),signature)||!relay.consumeRequestNonce(deviceId,nonce,started+120_000,started)){json(response,401,{error:'unauthorized'});return}
      if(!allowed(principals,`${workspaceId}:${deviceId}`,started,120)){json(response,429,{error:'rate_limited'});return}
      if(method==='POST'&&url.pathname==='/v1/invitations'){const value=JSON.parse(body.toString('utf8')) as {invitation:EnrollmentInvitation};json(response,201,authority.registerInvitation(value.invitation));return}
      if(method==='GET'&&url.pathname==='/v1/enrollments'){json(response,200,{requests:authority.pendingEnrollments(workspaceId,deviceId)});return}
      if(method==='POST'&&url.pathname==='/v1/enrollments/approve'){const value=JSON.parse(body.toString('utf8')) as {approval:EnrollmentApproval;wrappedWorkspaceKey:string};json(response,200,authority.approveEnrollment(workspaceId,deviceId,value.approval,value.wrappedWorkspaceKey));return}
      if(method==='GET'&&url.pathname==='/v1/devices'){json(response,200,{devices:authority.listDevices(workspaceId,deviceId)});return}
      if(method==='POST'&&url.pathname==='/v1/devices/revoke'){const value=JSON.parse(body.toString('utf8')) as {deviceId:string};json(response,200,authority.revoke(workspaceId,deviceId,String(value.deviceId)));return}
      if(method==='POST'&&url.pathname==='/v1/rotations/start'){json(response,200,authority.beginRotation(workspaceId,deviceId));return}
      if(method==='GET'&&url.pathname==='/v1/rotations'){json(response,200,{rotation:authority.rotationStatus(workspaceId,deviceId)});return}
      if(method==='POST'&&url.pathname==='/v1/rotations/wrap'){const value=JSON.parse(body.toString('utf8')) as {targetEpoch:number;deviceId:string;wrappedWorkspaceKey:string};json(response,200,authority.recordRotationWrap(workspaceId,deviceId,Number(value.targetEpoch),String(value.deviceId),String(value.wrappedWorkspaceKey)));return}
      if(method==='POST'&&url.pathname==='/v1/rotations/commit'){json(response,200,authority.commitRotation(workspaceId,deviceId));return}
      if(method==='POST'&&url.pathname==='/v1/messages'){
        const value=JSON.parse(body.toString('utf8')) as Record<string,unknown>,message:OpaqueRelayMessage={protocolVersion:Number(value.protocolVersion),messageId:String(value.messageId),workspaceId:String(value.workspaceId),recipientDeviceId:String(value.recipientDeviceId),senderDeviceId:String(value.senderDeviceId),keyEpoch:Number(value.keyEpoch),sequence:Number(value.sequence),createdAt:String(value.createdAt),expiresAt:String(value.expiresAt),envelope:new Uint8Array(Buffer.from(String(value.envelopeBase64),'base64'))}
        if(message.workspaceId!==workspaceId||message.senderDeviceId!==deviceId||message.keyEpoch!==keyEpoch){json(response,403,{error:'authority_mismatch'});return}json(response,202,relay.enqueue(message));return
      }
      if(method==='GET'&&url.pathname==='/v1/messages'){
        const recipientDeviceId=url.searchParams.get('recipientDeviceId')??'',requestedWorkspace=url.searchParams.get('workspaceId')??'',limit=Number(url.searchParams.get('limit')??100)
        if(requestedWorkspace!==workspaceId||recipientDeviceId!==deviceId){json(response,403,{error:'authority_mismatch'});return}json(response,200,{messages:relay.pull(workspaceId,recipientDeviceId,deviceId,new Date(),limit).map((item)=>({...item,envelopeBase64:Buffer.from(item.envelope).toString('base64'),envelope:undefined}))});return
      }
      if(method==='POST'&&url.pathname==='/v1/acks'){
        const value=JSON.parse(body.toString('utf8')) as Record<string,unknown>;if(value.workspaceId!==workspaceId||value.recipientDeviceId!==deviceId){json(response,403,{error:'authority_mismatch'});return}json(response,200,{acknowledged:relay.acknowledge(workspaceId,deviceId,deviceId,String(value.messageId))});return
      }
      json(response,404,{error:'not_found'})
    }catch(error){const code=error instanceof Error&&error.message==='request_too_large'?413:400;json(response,code,{error:code===413?'request_too_large':'invalid_request'})}finally{inFlight--}
  })
  server.maxHeadersCount=32;server.headersTimeout=10_000;server.requestTimeout=15_000;server.keepAliveTimeout=5_000;server.on('close',()=>{clearInterval(healthTimer);relay.close();authority.close()});return{server,relay}
}
