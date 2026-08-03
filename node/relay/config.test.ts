import {describe,expect,it} from 'vitest'
import {parseRelayConfig} from './config.js'
describe('relay configuration',()=>{
  const valid={WAYPOINT_RELAY_HOST:'127.0.0.1',WAYPOINT_RELAY_PORT:'8789',WAYPOINT_RELAY_DATABASE:'/var/lib/waypoint-relay/relay.sqlite',WAYPOINT_RELAY_AUTHORITY_REGISTRY:'/etc/waypoint-relay/authority.json',WAYPOINT_RELAY_WEBHOOK_KEY_FILE:'/etc/waypoint-relay/webhook.key',WAYPOINT_RELAY_TLS_MODE:'proxy-loopback'}
  it('accepts only explicit non-secret absolute-path configuration',()=>expect(parseRelayConfig(valid)).toMatchObject({port:8789,logLevel:'info',tlsMode:'proxy-loopback'}))
  it('rejects privileged ports, relative state, and secret-bearing environment',()=>{expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_PORT:'443'})).toThrow('port');expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_DATABASE:'relay.sqlite'})).toThrow('absolute');expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_TOKEN:'private'})).toThrow('Secrets')})
  it('requires loopback proxy TLS and fails closed on unsupported direct mode',()=>{expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_HOST:'0.0.0.0'})).toThrow('loopback');expect(()=>parseRelayConfig({...valid,WAYPOINT_RELAY_TLS_MODE:'direct'})).toThrow('proxy')})
})
