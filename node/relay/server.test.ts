import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import sodium from 'libsodium-wrappers-sumo'
import {afterEach,describe,expect,it} from 'vitest'
import {WaypointCrypto} from '../../electron/core/sync/crypto.js'
import {toOpaqueRelayMessage} from '../../electron/core/sync/relay-adapter.js'
import type {DeviceKeyPair} from '../../electron/core/sync/types.js'
import {canonicalRelayRequest,createRelayServer} from './server.js'

describe('hosted authenticated relay',()=>{
  const running:Array<Awaited<ReturnType<typeof createRelayServer>>['server']>=[]
  afterEach(async()=>{for(const server of running.splice(0))await new Promise<void>((resolve)=>server.close(()=>resolve()))})
  it('binds signed principals, persists nonce replay defense, and round-trips encrypted peer traffic',async()=>{
    await sodium.ready
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-hosted-')),database=path.join(root,'relay.sqlite'),registry=path.join(root,'authority.json'),crypto=await WaypointCrypto.create(),a=crypto.generateDevice('opaque_device_a_01'),b=crypto.generateDevice('opaque_device_b_01'),workspaceId='opaque_workspace_01',workspaceKey=crypto.generateWorkspaceKey()
    writeFileSync(registry,JSON.stringify({version:1,workspaces:[{workspaceId,keyEpoch:1,devices:[{...publicDevice(a),active:true,role:'owner'},{...publicDevice(b),active:true,role:'peer'}]}]}))
    const config={host:'127.0.0.1',port:8789,databasePath:database,authorityRegistryPath:registry,tlsMode:'proxy-loopback' as const,logLevel:'info' as const},instance=await createRelayServer(config)
    running.push(instance.server);await new Promise<void>((resolve)=>instance.server.listen(0,'127.0.0.1',resolve))
    const address=instance.server.address();if(!address||typeof address==='string')throw new Error('missing address')
    const base=`http://127.0.0.1:${address.port}`,envelope=crypto.encryptEnvelope({workspaceId,sender:a,recipient:b,workspaceKey,payload:{body:'hosted-private-sentinel'},keyEpoch:1,sequence:1,now:new Date(),ttlMs:60_000}),message=toOpaqueRelayMessage(envelope),enqueueBody={...message,envelope:undefined,envelopeBase64:Buffer.from(message.envelope).toString('base64')},fixedNonce=randomUUID()
    expect((await signedFetch(base,'POST','/v1/messages',a,workspaceId,1,enqueueBody,fixedNonce)).status).toBe(202)
    expect((await signedFetch(base,'POST','/v1/messages',a,workspaceId,1,enqueueBody,fixedNonce)).status).toBe(401)
    expect((await signedFetch(base,'GET',`/v1/messages?workspaceId=${workspaceId}&recipientDeviceId=${b.deviceId}`,a,workspaceId,1)).status).toBe(403)
    const pulled=await signedFetch(base,'GET',`/v1/messages?workspaceId=${workspaceId}&recipientDeviceId=${b.deviceId}`,b,workspaceId,1),payload=await pulled.json() as {messages:Array<{envelopeBase64:string}>}
    expect(pulled.status).toBe(200)
    expect(crypto.decryptEnvelope({envelope:JSON.parse(Buffer.from(payload.messages[0].envelopeBase64,'base64').toString('utf8')),recipient:b,sender:a,workspaceKey})).toEqual({body:'hosted-private-sentinel'})
    expect((await signedFetch(base,'POST','/v1/acks',a,workspaceId,1,{workspaceId,recipientDeviceId:b.deviceId,messageId:message.messageId})).status).toBe(403)
    expect((await signedFetch(base,'POST','/v1/acks',b,workspaceId,1,{workspaceId,recipientDeviceId:b.deviceId,messageId:message.messageId})).status).toBe(200)
    const healthStatuses=await Promise.all(Array.from({length:61},()=>fetch(`${base}/v1/health`).then((response)=>response.status)));expect(healthStatuses.filter((status)=>status===200)).toHaveLength(60);expect(healthStatuses).toContain(429);expect((await signedFetch(base,'GET',`/v1/messages?workspaceId=${workspaceId}&recipientDeviceId=${a.deviceId}`,a,workspaceId,1)).status).toBe(200)
  })
})

const publicDevice=({deviceId,signingPublicKey,encryptionPublicKey}:DeviceKeyPair)=>({deviceId,signingPublicKey,encryptionPublicKey})
async function signedFetch(base:string,method:string,requestPath:string,device:DeviceKeyPair,workspaceId:string,keyEpoch:number,value?:unknown,nonce=randomUUID()){const body=value===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),timestamp=new Date().toISOString(),canonical=canonicalRelayRequest(workspaceId,device.deviceId,keyEpoch,method,requestPath,timestamp,nonce,body),signature=sodium.to_base64(sodium.crypto_sign_detached(sodium.from_string(canonical),sodium.from_base64(device.signingPrivateKey,sodium.base64_variants.ORIGINAL)),sodium.base64_variants.ORIGINAL);return fetch(`${base}${requestPath}`,{method,headers:{'content-type':'application/json','x-waypoint-workspace':workspaceId,'x-waypoint-device':device.deviceId,'x-waypoint-epoch':String(keyEpoch),'x-waypoint-timestamp':timestamp,'x-waypoint-nonce':nonce,'x-waypoint-signature':signature},body:method==='GET'?undefined:body})}
