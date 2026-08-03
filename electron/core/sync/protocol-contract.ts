import type { OpaqueRelayMessage } from '../../../node/relay/types.js'

export const R0_PROTOCOL_CONTRACT=Object.freeze({
  protocolVersion:1,
  schemas:Object.freeze({objects:Object.freeze({minimum:1,maximum:1}),attachments:Object.freeze({minimum:1,maximum:2})}),
  retention:Object.freeze({tombstoneMinimumDays:90,relayEnvelopeMaximumDays:7,relayBackupMaximumDays:14,appManagedDiagnosticMaximumDays:7,userExportAutomaticDeletion:false,automaticPeerRevocation:false}),
  limits:Object.freeze({maxEnvelopeBytes:8*1024*1024,maxMessages:10_000,maxWorkspaceBytes:512*1024*1024}),
  support:Object.freeze({macOS:Object.freeze({minimum:'14.0',architectures:Object.freeze(['arm64'] as const),minimumRamGiB:8,minimumFreeDiskGiB:2}),windows:Object.freeze({minimum:'11',architectures:Object.freeze(['x64'] as const),minimumRamGiB:8,minimumFreeDiskGiB:2}),ubuntuRelay:Object.freeze({lts:'24.04',architectures:Object.freeze(['x64','arm64'] as const),minimumRamGiB:2,minimumFreeDiskGiB:20})}),
  recovery:Object.freeze({format:'waypoint-recovery',version:1,kdf:'argon2id13',opslimit:2,memlimitBytes:67_108_864,cipher:'xchacha20poly1305-ietf',serverEscrow:false,requiresOfflineArtifact:true}),
  release:Object.freeze({channel:'local-development',signed:false,publishAllowed:false}),
})

export const RELAY_VISIBLE_FIELDS=Object.freeze(['protocolVersion','messageId','workspaceId','recipientDeviceId','senderDeviceId','keyEpoch','sequence','createdAt','expiresAt','envelopeBytes'] as const)
export const NODE_METADATA_SURFACES=Object.freeze({
  delivery:Object.freeze([...RELAY_VISIBLE_FIELDS]),
  enrollment:Object.freeze(['protocolVersion','opaqueWorkspaceId','requestId','applicantDeviceId','applicantSigningPublicKey','applicantEncryptionPublicKey','requestSignature','ownerDeviceId','membershipEpoch','approvalSignature','wrappedWorkspaceKeyBytes','createdAt','expiresAt','consumedAt']),
  presence:Object.freeze(['opaqueWorkspaceId','deviceId','observedAt','expiresAt']),
  acknowledgement:Object.freeze(['opaqueWorkspaceId','recipientDeviceId','messageId','acknowledgedAt']),
  backup:Object.freeze(['backupVersion','createdAt','expiresAt','encryptedDatabaseBytes','integrityDigest']),
  neverNodeVisible:Object.freeze(['workspaceName','body','filename','objectId','prompt','workspaceKey','devicePrivateKey','recoveryPassphrase','cliCredential','rawExecutionOutput']),
})

export function relayMetadataView(message:OpaqueRelayMessage):Record<(typeof RELAY_VISIBLE_FIELDS)[number],string|number>{
  return{protocolVersion:message.protocolVersion,messageId:message.messageId,workspaceId:message.workspaceId,recipientDeviceId:message.recipientDeviceId,senderDeviceId:message.senderDeviceId,keyEpoch:message.keyEpoch,sequence:message.sequence,createdAt:message.createdAt,expiresAt:message.expiresAt,envelopeBytes:message.envelope.byteLength}
}

export interface RecoveryManifest{
  format:string;version:number;workspaceId:string;createdAt:string;kdf:'argon2id13';opslimit:number;memlimitBytes:number;cipher:'xchacha20poly1305-ietf';salt:string;nonce:string;wrappedWorkspaceKey:string;checksum:string
}

export function validateRecoveryManifest(value:unknown,now=new Date()):RecoveryManifest{
  if(!value||typeof value!=='object')throw new Error('Recovery manifest is required')
  const manifest=value as Partial<RecoveryManifest>,created=Date.parse(String(manifest.createdAt))
  const allowed=['format','version','workspaceId','createdAt','kdf','opslimit','memlimitBytes','cipher','salt','nonce','wrappedWorkspaceKey','checksum']
  if(Object.keys(manifest).some((key)=>!allowed.includes(key)))throw new Error('Unexpected recovery manifest field')
  if(manifest.format!==R0_PROTOCOL_CONTRACT.recovery.format||manifest.version!==R0_PROTOCOL_CONTRACT.recovery.version||manifest.kdf!==R0_PROTOCOL_CONTRACT.recovery.kdf||manifest.opslimit!==R0_PROTOCOL_CONTRACT.recovery.opslimit||manifest.memlimitBytes!==R0_PROTOCOL_CONTRACT.recovery.memlimitBytes||manifest.cipher!==R0_PROTOCOL_CONTRACT.recovery.cipher)throw new Error('Unsupported recovery manifest')
  if(typeof manifest.workspaceId!=='string'||manifest.workspaceId.length<16||manifest.workspaceId.length>128)throw new Error('Invalid recovery workspaceId')
  const decodedLength=(encoded:unknown)=>{if(typeof encoded!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return-1;const bytes=Buffer.from(encoded,'base64');return bytes.toString('base64')===encoded?bytes.length:-1}
  if(decodedLength(manifest.salt)!==16)throw new Error('Invalid recovery salt')
  if(decodedLength(manifest.nonce)!==24)throw new Error('Invalid recovery nonce')
  if(decodedLength(manifest.wrappedWorkspaceKey)!==48)throw new Error('Invalid recovery wrappedWorkspaceKey')
  if(typeof manifest.checksum!=='string'||!/^sha256-[a-f0-9]{64}$/.test(manifest.checksum))throw new Error('Invalid recovery checksum')
  if(!Number.isFinite(created)||created>now.getTime()+300_000)throw new Error('Invalid recovery creation time')
  return manifest as RecoveryManifest
}
