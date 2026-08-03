import {mkdtempSync,readFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WaypointCrypto} from './crypto.js'
import {ProtectedSyncVault,type SecretProtector} from './protected-sync-vault.js'

const protector:SecretProtector={available:()=>true,encrypt:(value)=>new Uint8Array(Buffer.from(value).map((byte)=>byte^0xa5)),decrypt:(value)=>Buffer.from(Buffer.from(value).map((byte)=>byte^0xa5)).toString('utf8')}
describe('protected sync vault',()=>{
  it('fails closed without OS protection',()=>expect(()=>new ProtectedSyncVault('/unused',{...protector,available:()=>false})).toThrow('unavailable'))
  it('atomically persists secrets without plaintext and enforces ownership',async()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-vault-')),crypto=await WaypointCrypto.create(),value={version:1 as const,workspaceId:'opaque_workspace_01',device:crypto.generateDevice('opaque_device_001'),workspaceKey:crypto.generateWorkspaceKey(),keyEpoch:1,endpoint:'https://waypoint-relay.johnnycode.ai'},vault=new ProtectedSyncVault(root,protector);vault.save(value);const file=path.join(root,readdirSync(root)[0]),bytes=readFileSync(file);expect(bytes.includes(Buffer.from(value.workspaceKey))).toBe(false);expect(bytes.includes(Buffer.from(value.device.signingPrivateKey))).toBe(false);expect(vault.load(value.workspaceId)).toEqual(value);expect(()=>vault.load('opaque_workspace_02')).not.toThrow();vault.remove(value.workspaceId);expect(vault.load(value.workspaceId)).toBeUndefined()})
  it('rejects unpinned endpoints and malformed key material',async()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-vault-invalid-')),crypto=await WaypointCrypto.create(),vault=new ProtectedSyncVault(root,protector),base={version:1 as const,workspaceId:'opaque_workspace_01',device:crypto.generateDevice('opaque_device_001'),workspaceKey:crypto.generateWorkspaceKey(),keyEpoch:1,endpoint:'https://waypoint-relay.johnnycode.ai'};expect(()=>vault.save({...base,endpoint:'https://evil.invalid'})).toThrow('Invalid');expect(()=>vault.save({...base,workspaceKey:'bad'})).toThrow('Invalid')})
})
