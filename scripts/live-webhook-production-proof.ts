import {chmodSync,writeFileSync,readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import sodium from 'libsodium-wrappers-sumo'
import {canonicalRelayRequest} from '../electron/core/sync/relay-request.js'
import {openInboundWebhook,prepareSignedWebhook} from '../electron/core/sync/webhook-crypto.js'

interface ProofState{workspaceId:string;deviceId:string;signingPublicKey:string;signingPrivateKey:string;encryptionPublicKey:string;encryptionPrivateKey:string;pending?:{channelId:string;eventId:string}}
const encode=(value:Uint8Array)=>sodium.to_base64(value,sodium.base64_variants.ORIGINAL)

async function initialize(registryPath:string,statePath:string){
  await sodium.ready
  const signing=sodium.crypto_sign_keypair(),encryption=sodium.crypto_box_keypair(),state:ProofState={workspaceId:`proof_workspace_${randomUUID().replaceAll('-','')}`,deviceId:`proof_device_${randomUUID().replaceAll('-','')}`,signingPublicKey:encode(signing.publicKey),signingPrivateKey:encode(signing.privateKey),encryptionPublicKey:encode(encryption.publicKey),encryptionPrivateKey:encode(encryption.privateKey)}
  writeFileSync(registryPath,JSON.stringify({version:1,workspaces:[{workspaceId:state.workspaceId,keyEpoch:1,devices:[{deviceId:state.deviceId,signingPublicKey:state.signingPublicKey,encryptionPublicKey:state.encryptionPublicKey,role:'owner',active:true}]}]},null,2),{mode:0o600})
  writeFileSync(statePath,JSON.stringify(state),{mode:0o600});chmodSync(registryPath,0o600);chmodSync(statePath,0o600)
  process.stdout.write(JSON.stringify({initialized:true})+'\n')
}

async function run(endpoint:string,statePath:string){
  await sodium.ready
  const state=JSON.parse(readFileSync(statePath,'utf8')) as ProofState
  const auth=async(method:string,path:string,value?:unknown)=>{const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),timestamp=new Date().toISOString(),nonce=randomUUID(),canonical=canonicalRelayRequest(state.workspaceId,state.deviceId,1,method,path,timestamp,nonce,body),signature=encode(sodium.crypto_sign_detached(sodium.from_string(canonical),sodium.from_base64(state.signingPrivateKey,sodium.base64_variants.ORIGINAL))),response=await fetch(`${endpoint}${path}`,{method,headers:{'content-type':'application/json','x-waypoint-workspace':state.workspaceId,'x-waypoint-device':state.deviceId,'x-waypoint-epoch':'1','x-waypoint-timestamp':timestamp,'x-waypoint-nonce':nonce,'x-waypoint-signature':signature},body:body.length?body:undefined});return{status:response.status,value:await response.json() as Record<string,unknown>}}
  const create=await auth('POST','/v1/webhook-channels',{label:'Production proof'});if(create.status!==201)throw new Error(`channel_create_${create.status}`)
  const channel=create.value as unknown as {channelId:string;secretVersion:number;secret:string;recipientPublicKey:string}
  const signed=await prepareSignedWebhook({channelId:channel.channelId,secretVersion:channel.secretVersion,secret:channel.secret,recipientPublicKey:channel.recipientPublicKey,eventType:'waypoint.production-proof',payload:{fixture:true}})
  const send=()=>fetch(`${endpoint}${signed.path}`,{method:'POST',headers:signed.headers,body:signed.body})
  const accepted=await send();if(accepted.status!==202)throw new Error(`accept_${accepted.status}`)
  const replay=await send();if(replay.status!==401)throw new Error(`replay_${replay.status}`)
  const pulled=await auth('GET','/v1/webhook-events?limit=10');const events=pulled.value.events as Array<{eventId:string;ciphertextBase64:string}>;if(pulled.status!==200||events.length!==1||events[0].eventId!==signed.eventId)throw new Error('pull_mismatch')
  const opened=await openInboundWebhook(events[0].ciphertextBase64,state.encryptionPublicKey,state.encryptionPrivateKey);if(opened.eventType!=='waypoint.production-proof'||opened.payload.fixture!==true)throw new Error('decrypt_mismatch')
  const ack=await auth('POST','/v1/webhook-acks',{eventId:signed.eventId});if(ack.status!==200||ack.value.acknowledged!==true)throw new Error('ack_failed')
  const rotated=await auth('POST',`/v1/webhook-channels/${channel.channelId}/rotate`);if(rotated.status!==200)throw new Error('rotate_failed')
  const oldAfterRotate=await prepareSignedWebhook({channelId:channel.channelId,secretVersion:channel.secretVersion,secret:channel.secret,recipientPublicKey:channel.recipientPublicKey,eventType:'waypoint.old-secret',payload:{fixture:true}});const oldResponse=await fetch(`${endpoint}${oldAfterRotate.path}`,{method:'POST',headers:oldAfterRotate.headers,body:oldAfterRotate.body});if(oldResponse.status!==400)throw new Error(`old_secret_${oldResponse.status}`)
  const kill=await auth('POST','/v1/webhook-kill',{active:true});if(kill.status!==200)throw new Error('kill_failed')
  const current=rotated.value as unknown as {secretVersion:number;secret:string;recipientPublicKey:string},killedEvent=await prepareSignedWebhook({channelId:channel.channelId,secretVersion:current.secretVersion,secret:current.secret,recipientPublicKey:current.recipientPublicKey,eventType:'waypoint.killed',payload:{fixture:true}}),killed=await fetch(`${endpoint}${killedEvent.path}`,{method:'POST',headers:killedEvent.headers,body:killedEvent.body});if(killed.status!==401)throw new Error(`kill_effect_${killed.status}`)
  await auth('POST','/v1/webhook-kill',{active:false});const deleted=await auth('POST',`/v1/webhook-channels/${channel.channelId}/delete`);if(deleted.status!==200||deleted.value.deleted!==true)throw new Error('delete_failed')
  process.stdout.write(JSON.stringify({ok:true,accepted:202,replayRejected:401,decryptedLocally:true,acknowledged:true,oldSecretRejected:true,killSwitchRejected:true,deleted:true})+'\n')
}

async function persistence(endpoint:string,statePath:string,mode:'stage'|'resume'){
  await sodium.ready
  const state=JSON.parse(readFileSync(statePath,'utf8')) as ProofState
  const auth=async(method:string,path:string,value?:unknown)=>{const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),timestamp=new Date().toISOString(),nonce=randomUUID(),canonical=canonicalRelayRequest(state.workspaceId,state.deviceId,1,method,path,timestamp,nonce,body),signature=encode(sodium.crypto_sign_detached(sodium.from_string(canonical),sodium.from_base64(state.signingPrivateKey,sodium.base64_variants.ORIGINAL))),response=await fetch(`${endpoint}${path}`,{method,headers:{'content-type':'application/json','x-waypoint-workspace':state.workspaceId,'x-waypoint-device':state.deviceId,'x-waypoint-epoch':'1','x-waypoint-timestamp':timestamp,'x-waypoint-nonce':nonce,'x-waypoint-signature':signature},body:body.length?body:undefined});return{status:response.status,value:await response.json() as Record<string,unknown>}}
  if(mode==='stage'){
    const created=await auth('POST','/v1/webhook-channels',{label:'Restart proof'});if(created.status!==201)throw new Error('persistence_channel_failed');const channel=created.value as unknown as {channelId:string;secretVersion:number;secret:string;recipientPublicKey:string},signed=await prepareSignedWebhook({channelId:channel.channelId,secretVersion:channel.secretVersion,secret:channel.secret,recipientPublicKey:channel.recipientPublicKey,eventType:'waypoint.restart-proof',payload:{fixture:true}}),accepted=await fetch(`${endpoint}${signed.path}`,{method:'POST',headers:signed.headers,body:signed.body});if(accepted.status!==202)throw new Error('persistence_accept_failed');state.pending={channelId:channel.channelId,eventId:signed.eventId};writeFileSync(statePath,JSON.stringify(state),{mode:0o600});chmodSync(statePath,0o600);process.stdout.write(JSON.stringify({staged:true})+'\n');return
  }
  if(!state.pending)throw new Error('persistence_state_missing');const pulled=await auth('GET','/v1/webhook-events?limit=10'),events=pulled.value.events as Array<{eventId:string;ciphertextBase64:string}>,event=events.find((item)=>item.eventId===state.pending!.eventId);if(pulled.status!==200||!event)throw new Error('persistence_pull_failed');const opened=await openInboundWebhook(event.ciphertextBase64,state.encryptionPublicKey,state.encryptionPrivateKey);if(opened.eventType!=='waypoint.restart-proof')throw new Error('persistence_decrypt_failed');await auth('POST','/v1/webhook-acks',{eventId:event.eventId});await auth('POST',`/v1/webhook-channels/${state.pending.channelId}/delete`);delete state.pending;writeFileSync(statePath,JSON.stringify(state),{mode:0o600});process.stdout.write(JSON.stringify({persistedAcrossRestart:true,decryptedLocally:true,cleaned:true})+'\n')
}

const [command,...args]=process.argv.slice(2)
if(command==='init'&&args.length===2)await initialize(args[0],args[1])
else if(command==='run'&&args.length===2)await run(args[0].replace(/\/$/,''),args[1])
else if((command==='stage'||command==='resume')&&args.length===2)await persistence(args[0].replace(/\/$/,''),args[1],command)
else throw new Error('Usage: live-webhook-production-proof init <registry> <state> | run|stage|resume <endpoint> <state>')
