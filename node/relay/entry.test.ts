import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe,expect,it} from 'vitest'
import {validateRelayRuntime} from './entry.js'

describe('relay deployment entrypoint',()=>{
  it('validates readable authority and webhook-key files for loopback proxy TLS',()=>{const root=mkdtempSync(path.join(tmpdir(),'waypoint-entry-')),registry=path.join(root,'authority.json'),key=path.join(root,'webhook.key');writeFileSync(registry,'{}');writeFileSync(key,Buffer.alloc(32));expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:path.join(root,'relay.sqlite'),WAYPOINT_RELAY_AUTHORITY_REGISTRY:registry,WAYPOINT_RELAY_WEBHOOK_KEY_FILE:key,WAYPOINT_RELAY_TLS_MODE:'proxy-loopback'})).not.toThrow()})
  it('fails when a configured protected file is missing',()=>expect(()=>validateRelayRuntime({WAYPOINT_RELAY_DATABASE:'/var/lib/waypoint-relay/relay.sqlite',WAYPOINT_RELAY_AUTHORITY_REGISTRY:'/missing/authority.json',WAYPOINT_RELAY_WEBHOOK_KEY_FILE:'/missing/webhook.key',WAYPOINT_RELAY_TLS_MODE:'proxy-loopback'})).toThrow())
})
