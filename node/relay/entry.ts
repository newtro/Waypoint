import {accessSync,constants,realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parseRelayConfig} from './config.js'
import {createRelayServer} from './server.js'

/**
 * R1 deliberately stops before a hosted enrollment authority is configured.
 * The deployment entrypoint therefore validates its non-secret runtime closure
 * and then fails closed instead of starting an unauthenticated relay.
 */
export function validateRelayRuntime(input:Record<string,string|undefined>):void{
  const config=parseRelayConfig(input)
  accessSync(config.authorityRegistryPath,constants.R_OK)
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
  try{validateRelayRuntime(process.env);const config=parseRelayConfig(process.env),{server}=await createRelayServer(config);server.listen(config.port,config.host,()=>process.stdout.write(JSON.stringify({event:'relay_started',host:config.host,port:config.port})+'\n'));const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop)}catch{process.stderr.write(JSON.stringify({event:'relay_startup_rejected'})+'\n');process.exitCode=78}
}
