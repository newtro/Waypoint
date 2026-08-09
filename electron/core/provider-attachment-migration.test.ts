import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {describe,expect,it} from 'vitest'
import {WorkspaceStore} from './store.js'
import {CURRENT_SCHEMA_VERSION,schemaVersion} from './migrations.js'

describe('provider attachment route migration',()=>{
  it('preserves existing OpenRouter roles and adds a non-executing curated image default',()=>{
    const root=mkdtempSync(path.join(tmpdir(),'waypoint-provider-route-')),database=path.join(root,'waypoint.sqlite'),store=new WorkspaceStore(database)
    store.setOpenRouterSettings({enabled:true,liveRequestsEnabled:true,strategicModel:'legacy/strategy',everydayModel:'legacy/everyday',attachmentModel:'qwen/qwen3.8-max',fallbackProvider:'claude',monthlyCapMicros:123,ytdCapMicros:456,perRequestCapMicros:78,warningPercent:75});store.close()
    const legacy=new DatabaseSync(database);legacy.exec('ALTER TABLE provider_settings DROP COLUMN attachment_model');legacy.prepare('DELETE FROM schema_versions WHERE version=39').run();expect(schemaVersion(legacy)).toBe(38);legacy.close()
    const migrated=new WorkspaceStore(database),settings=migrated.openRouterSettings(),verification=new DatabaseSync(database);expect(schemaVersion(verification)).toBe(CURRENT_SCHEMA_VERSION);verification.close();expect(settings).toMatchObject({enabled:true,liveRequestsEnabled:true,strategicModel:'legacy/strategy',everydayModel:'legacy/everyday',attachmentModel:'moonshotai/kimi-k3',fallbackProvider:'claude',monthlyCapMicros:123,ytdCapMicros:456,perRequestCapMicros:78,warningPercent:75});migrated.close()
  })
})
