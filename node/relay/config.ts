import path from 'node:path'

export interface RelayConfig{host:string;port:number;databasePath:string;authorityRegistryPath:string;webhookKeyPath:string;tlsMode:'proxy-loopback';logLevel:'error'|'warn'|'info'}
export function parseRelayConfig(input:Record<string,string|undefined>):RelayConfig{
  const port=Number(input.WAYPOINT_RELAY_PORT??'8443'),host=input.WAYPOINT_RELAY_HOST??'127.0.0.1',databasePath=input.WAYPOINT_RELAY_DATABASE??'',authorityRegistryPath=input.WAYPOINT_RELAY_AUTHORITY_REGISTRY??'',webhookKeyPath=input.WAYPOINT_RELAY_WEBHOOK_KEY_FILE??'',tlsMode=input.WAYPOINT_RELAY_TLS_MODE,logLevel=input.WAYPOINT_RELAY_LOG_LEVEL??'info'
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Relay port must be between 1024 and 65535')
  if(!/^(127\.0\.0\.1|::1|[a-zA-Z0-9.-]+)$/.test(host))throw new Error('Relay host is invalid')
  if(!path.isAbsolute(databasePath)||!path.isAbsolute(authorityRegistryPath)||!path.isAbsolute(webhookKeyPath))throw new Error('Relay database, authority registry, and webhook key paths must be absolute')
  if(tlsMode!=='proxy-loopback')throw new Error('Relay requires TLS termination at the loopback proxy')
  if(!['127.0.0.1','::1'].includes(host))throw new Error('Proxy TLS mode requires a loopback host')
  if(!['error','warn','info'].includes(logLevel))throw new Error('Relay log level is invalid')
  if(Object.keys(input).some((key)=>key.startsWith('WAYPOINT_RELAY_')&&/SECRET|TOKEN|PASSWORD|WORKSPACE_KEY|CLI_CREDENTIAL/.test(key)&&input[key]))throw new Error('Secrets must not be supplied through relay environment configuration')
  return{host,port,databasePath,authorityRegistryPath,webhookKeyPath,tlsMode,logLevel:logLevel as RelayConfig['logLevel']}
}
