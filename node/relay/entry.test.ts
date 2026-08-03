import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {validateRelayRuntime} from './entry.js'

describe('relay deployment entrypoint',()=>{
  it('validates a readable authority registry for loopback proxy TLS',()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-entry-')),registry=path.join(root,'authority.json');writeFileSync(registry,'{}');expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:path.join(root,'relay.sqlite'),WAYPOINT_RELAY_AUTHORITY_REGISTRY:registry,WAYPOINT_RELAY_TLS_MODE:'proxy-loopback'})).not.toThrow()})
  it('fails when the configured authority registry is missing',()=>expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:'/var/lib/waypoint-relay/relay.sqlite',WAYPOINT_RELAY_AUTHORITY_REGISTRY:'/missing/authority.json',WAYPOINT_RELAY_TLS_MODE:'proxy-loopback'})).toThrow())
})
