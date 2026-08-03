import {readFileSync} from 'node:fs'
import sodium from 'libsodium-wrappers-sumo'
import type {DeviceIdentity} from '../../electron/core/sync/types.js'
import {WaypointCrypto} from '../../electron/core/sync/crypto.js'
import {verifyOpaqueRelayMessage} from '../../electron/core/sync/relay-adapter.js'
import type {OpaqueRelayMessage,RelayAuthority} from './types.js'

const ID=/^[A-Za-z0-9_-]{16,128}$/
interface RegistryDevice extends DeviceIdentity{active:boolean;role:'owner'|'peer'}
interface RegistryWorkspace{keyEpoch:number;devices:RegistryDevice[]}
interface Registry{version:1;workspaces:Array<{workspaceId:string}&RegistryWorkspace>}

export class FileRelayAuthority implements RelayAuthority{
  private constructor(private readonly workspaces:Map<string,RegistryWorkspace>,private readonly crypto:WaypointCrypto){}
  static async load(filePath:string):Promise<FileRelayAuthority>{await sodium.ready;const value=JSON.parse(readFileSync(filePath,'utf8')) as Partial<Registry>;if(Object.keys(value).some((key)=>!['version','workspaces'].includes(key))||value.version!==1||!Array.isArray(value.workspaces))throw new Error('Unsupported relay authority registry');const workspaces=new Map<string,RegistryWorkspace>(),signingKeys=new Set<string>(),validKey=(key:unknown)=>{if(typeof key!=='string')return false;try{return sodium.from_base64(key,sodium.base64_variants.ORIGINAL).length===32}catch{return false}};for(const item of value.workspaces){if(Object.keys(item).some((key)=>!['workspaceId','keyEpoch','devices'].includes(key))||!ID.test(item.workspaceId)||!Number.isSafeInteger(item.keyEpoch)||item.keyEpoch<1||!Array.isArray(item.devices)||workspaces.has(item.workspaceId))throw new Error('Invalid relay authority workspace');const seen=new Set<string>();let owners=0;for(const device of item.devices){if(Object.keys(device).some((key)=>!['deviceId','signingPublicKey','encryptionPublicKey','active','role'].includes(key))||!ID.test(device.deviceId)||seen.has(device.deviceId)||signingKeys.has(device.signingPublicKey)||typeof device.active!=='boolean'||!['owner','peer'].includes(device.role)||!validKey(device.signingPublicKey)||!validKey(device.encryptionPublicKey))throw new Error('Invalid relay authority device');if(device.role==='owner'&&device.active)owners++;seen.add(device.deviceId);signingKeys.add(device.signingPublicKey)}if(owners!==1)throw new Error('Relay authority requires exactly one active owner');workspaces.set(item.workspaceId,{keyEpoch:item.keyEpoch,devices:item.devices})}return new FileRelayAuthority(workspaces,await WaypointCrypto.create())}
  isActive(workspaceId:string,deviceId:string,keyEpoch:number):boolean{const workspace=this.workspaces.get(workspaceId);return Boolean(workspace&&workspace.keyEpoch===keyEpoch&&workspace.devices.some((device)=>device.deviceId===deviceId&&device.active))}
  verifySignature(message:OpaqueRelayMessage):boolean{const workspace=this.workspaces.get(message.workspaceId),sender=workspace?.devices.find((device)=>device.deviceId===message.senderDeviceId&&device.active);return Boolean(sender&&verifyOpaqueRelayMessage(message,sender,this.crypto))}
  verifyRequest(workspaceId:string,deviceId:string,keyEpoch:number,canonical:string,signature:string):boolean{const workspace=this.workspaces.get(workspaceId),device=workspace?.devices.find((candidate)=>candidate.deviceId===deviceId&&candidate.active);if(!device||workspace?.keyEpoch!==keyEpoch)return false;try{return sodium.crypto_sign_verify_detached(sodium.from_base64(signature,sodium.base64_variants.ORIGINAL),sodium.from_string(canonical),sodium.from_base64(device.signingPublicKey,sodium.base64_variants.ORIGINAL))}catch{return false}}
}
