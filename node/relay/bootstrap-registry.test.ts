import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {WaypointCrypto} from '../../electron/core/sync/crypto.js'
import {bootstrapOwnerRegistry} from './bootstrap-registry.js'

describe('owner bootstrap registry ceremony',()=>{
  it('adds exactly one public owner and rejects replay',async()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-bootstrap-')),registry=path.join(root,'authority.json');writeFileSync(registry,JSON.stringify({version:1,workspaces:[]}));const crypto=await WaypointCrypto.create(),owner=crypto.generateDevice('opaque_owner_00001');await bootstrapOwnerRegistry(registry,'opaque_workspace_01',owner);const saved=readFileSync(registry,'utf8');expect(saved).toContain(owner.signingPublicKey);expect(saved).not.toContain(owner.signingPrivateKey);await expect(bootstrapOwnerRegistry(registry,'opaque_workspace_01',owner)).rejects.toThrow('already exists')})
})
