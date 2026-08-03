import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WaypointCrypto} from '../../electron/core/sync/crypto.js'
import {FileRelayAuthority} from './authority.js'
import {canonicalRelayRequest} from './server.js'

describe('hosted relay authority binding',()=>{
  it('binds workspace, device, and epoch into the signed request',()=>{const body=new Uint8Array([1]);expect(canonicalRelayRequest('workspace_opaque_01','device_opaque_001',1,'GET','/v1/messages','2026-08-03T12:00:00.000Z','nonce_opaque_0001',body)).not.toBe(canonicalRelayRequest('workspace_opaque_01','device_opaque_002',1,'GET','/v1/messages','2026-08-03T12:00:00.000Z','nonce_opaque_0001',body));expect(canonicalRelayRequest('workspace_opaque_01','device_opaque_001',1,'GET','/v1/messages','2026-08-03T12:00:00.000Z','nonce_opaque_0001',body)).not.toBe(canonicalRelayRequest('workspace_opaque_01','device_opaque_001',2,'GET','/v1/messages','2026-08-03T12:00:00.000Z','nonce_opaque_0001',body))})
  it('rejects a signing key aliased across identities',async()=>{const crypto=await WaypointCrypto.create(),owner=crypto.generateDevice('owner_device_0001'),alias=crypto.generateDevice('alias_device_0001'),root=mkdtempSync(path.join(tmpdir(),'waypoint-authority-')),file=path.join(root,'authority.json');writeFileSync(file,JSON.stringify({version:1,workspaces:[{workspaceId:'workspace_opaque_01',keyEpoch:1,devices:[{deviceId:owner.deviceId,signingPublicKey:owner.signingPublicKey,encryptionPublicKey:owner.encryptionPublicKey,active:true,role:'owner'},{deviceId:alias.deviceId,signingPublicKey:owner.signingPublicKey,encryptionPublicKey:alias.encryptionPublicKey,active:true,role:'peer'}]}]}));await expect(FileRelayAuthority.load(file)).rejects.toThrow('device')})
})
