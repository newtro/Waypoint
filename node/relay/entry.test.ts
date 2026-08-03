import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {validateRelayRuntime} from './entry.js'

describe('relay deployment entrypoint',()=>{
  it('validates readable TLS assets without starting an unauthenticated listener',()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-entry-')),cert=path.join(root,'cert.pem'),key=path.join(root,'key.pem');writeFileSync(cert,'fixture');writeFileSync(key,'fixture');expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:path.join(root,'relay.sqlite'),WAYPOINT_RELAY_TLS_CERT:cert,WAYPOINT_RELAY_TLS_KEY:key})).not.toThrow()})
  it('fails when a configured TLS asset is missing',()=>expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:'/var/lib/waypoint-relay/relay.sqlite',WAYPOINT_RELAY_TLS_CERT:'/missing/cert',WAYPOINT_RELAY_TLS_KEY:'/missing/key'})).toThrow())
})
