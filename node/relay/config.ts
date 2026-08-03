import path from 'node:path'

export interface RelayConfig{host:string;port:number;databasePath:string;tlsCertificatePath:string;tlsPrivateKeyPath:string;logLevel:'error'|'warn'|'info'}
export function parseRelayConfig(input:Record<string,string|undefined>):RelayConfig{
  const port=Number(input.WAYPOINT_RELAY_PORT??'8443'),host=input.WAYPOINT_RELAY_HOST??'127.0.0.1',databasePath=input.WAYPOINT_RELAY_DATABASE??'',tlsCertificatePath=input.WAYPOINT_RELAY_TLS_CERT??'',tlsPrivateKeyPath=input.WAYPOINT_RELAY_TLS_KEY??'',logLevel=input.WAYPOINT_RELAY_LOG_LEVEL??'info'
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Relay port must be between 1024 and 65535')
  if(!/^(127\.0\.0\.1|::1|[a-zA-Z0-9.-]+)$/.test(host))throw new Error('Relay host is invalid')
  if(!path.isAbsolute(databasePath)||!path.isAbsolute(tlsCertificatePath)||!path.isAbsolute(tlsPrivateKeyPath))throw new Error('Relay database and TLS paths must be absolute')
  if(!['error','warn','info'].includes(logLevel))throw new Error('Relay log level is invalid')
  if(Object.keys(input).some((key)=>key.startsWith('WAYPOINT_RELAY_')&&/SECRET|TOKEN|PASSWORD|WORKSPACE_KEY|CLI_CREDENTIAL/.test(key)&&input[key]))throw new Error('Secrets must not be supplied through relay environment configuration')
  return{host,port,databasePath,tlsCertificatePath,tlsPrivateKeyPath,logLevel:logLevel as RelayConfig['logLevel']}
}
