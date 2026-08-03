import {accessSync,constants} from 'node:fs'
import {parseRelayConfig} from './config.js'

/**
 * R1 deliberately stops before a hosted enrollment authority is configured.
 * The deployment entrypoint therefore validates its non-secret runtime closure
 * and then fails closed instead of starting an unauthenticated relay.
 */
export function validateRelayRuntime(input:Record<string,string|undefined>):void{
  const config=parseRelayConfig(input)
  accessSync(config.tlsCertificatePath,constants.R_OK)
  accessSync(config.tlsPrivateKeyPath,constants.R_OK)
}

if(import.meta.url===`file://${process.argv[1]}`){
  validateRelayRuntime(process.env)
  process.stderr.write('Hosted relay authority is not configured; deployment is not authorized\n')
  process.exitCode=78
}
