import {randomUUID} from 'node:crypto'
import {readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import sodium from 'libsodium-wrappers-sumo'
import type {DeviceIdentity} from '../../electron/core/sync/types.js'

const ID=/^[A-Za-z0-9_-]{16,128}$/
interface Registry{version:1;workspaces:Array<{workspaceId:string;keyEpoch:number;devices:Array<DeviceIdentity&{active:boolean;role:'owner'|'peer'}>}>}

/** Explicit operator ceremony: accepts public identity only and fails if the workspace already exists. */
export async function bootstrapOwnerRegistry(filePath:string,workspaceId:string,owner:DeviceIdentity):Promise<void>{
  await sodium.ready
  if(!ID.test(workspaceId)||!ID.test(owner.deviceId)||!validKey(owner.signingPublicKey)||!validKey(owner.encryptionPublicKey))throw new Error('Invalid public owner bootstrap bundle')
  const registry=JSON.parse(readFileSync(filePath,'utf8')) as Registry
  if(registry.version!==1||!Array.isArray(registry.workspaces))throw new Error('Unsupported relay authority registry')
  if(registry.workspaces.some((item)=>item.workspaceId===workspaceId))throw new Error('Workspace authority already exists')
  if(registry.workspaces.some((item)=>item.devices.some((device)=>device.signingPublicKey===owner.signingPublicKey)))throw new Error('Owner signing identity is already registered')
  registry.workspaces.push({workspaceId,keyEpoch:1,devices:[{deviceId:owner.deviceId,signingPublicKey:owner.signingPublicKey,encryptionPublicKey:owner.encryptionPublicKey,active:true,role:'owner'}]})
  const temporary=`${filePath}.${randomUUID()}.partial`
  try{writeFileSync(temporary,`${JSON.stringify(registry,null,2)}\n`,{flag:'wx',mode:0o600});renameSync(temporary,filePath)}catch(error){rmSync(temporary,{force:true});throw error}
}
function validKey(value:string){try{return sodium.from_base64(value,sodium.base64_variants.ORIGINAL).length===32}catch{return false}}
