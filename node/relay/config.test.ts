import {describe,expect,it} from 'vitest'
import {parseRelayConfig} from './config.js'
describe('relay configuration',()=>{
  const valid={WAYPOINT_RELAY_HOST:'127.0.0.1',WAYPOINT_RELAY_PORT:'8443',WAYPOINT_RELAY_DATABASE:'/var/lib/waypoint-relay/relay.sqlite',WAYPOINT_RELAY_TLS_CERT:'/etc/waypoint-relay/tls/fullchain.pem',WAYPOINT_RELAY_TLS_KEY:'/etc/waypoint-relay/tls/key.pem'}
  it('accepts only explicit non-secret absolute-path configuration',()=>expect(parseRelayConfig(valid)).toMatchObject({port:8443,logLevel:'info'}))
  it('rejects privileged ports, relative state, and secret-bearing environment',()=>{expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_PORT:'443'})).toThrow('port');expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_DATABASE:'relay.sqlite'})).toThrow('absolute');expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_TOKEN:'private'})).toThrow('Secrets')})
})
