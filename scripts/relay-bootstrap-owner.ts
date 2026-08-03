import {bootstrapOwnerRegistry} from '../node/relay/bootstrap-registry.js'

const [registryPath,workspaceId,deviceId,signingPublicKey,encryptionPublicKey]=process.argv.slice(2)
if(!registryPath||!workspaceId||!deviceId||!signingPublicKey||!encryptionPublicKey)throw new Error('Usage: relay-bootstrap-owner <registry> <workspaceId> <deviceId> <signingPublicKey> <encryptionPublicKey>')
await bootstrapOwnerRegistry(registryPath,workspaceId,{deviceId,signingPublicKey,encryptionPublicKey})
console.log(JSON.stringify({ok:true,workspaceId,deviceId,restartRequired:true}))
