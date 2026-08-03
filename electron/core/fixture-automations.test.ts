import {describe,expect,it} from 'vitest'
import {FIXTURE_CONNECTOR,FIXTURE_ITEMS,assertTimezone,fixtureDryRun,nextDailyOccurrence} from './fixture-automations.js'

describe('fixture automation authority boundary',()=>{
  it('deduplicates ordered fixtures without interpreting injection text',()=>{const result=fixtureDryRun();expect(result).toMatchObject({inputCount:3,deduplicatedCount:2,proposedEffects:0});expect(result.permissionSnapshot).toMatchObject({scopes:['fixture.read'],read:true,draft:false,write:false});expect(JSON.stringify(result)).not.toContain(FIXTURE_ITEMS[1].body);expect(FIXTURE_CONNECTOR).toMatchObject({network:false,tokenReference:false,fixture:true})})
  it('previews DST-aware daily wall time and rejects invalid zones',()=>{expect(nextDailyOccurrence('America/New_York',9,30,'2026-03-08T12:00:00.000Z')).toBe('2026-03-08T13:30:00.000Z');expect(nextDailyOccurrence('America/New_York',2,30,'2026-03-08T05:00:00.000Z')).toBe('2026-03-09T06:30:00.000Z');expect(()=>assertTimezone('Private/Invalid')).toThrow(/timezone/)})
})
