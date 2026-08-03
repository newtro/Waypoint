import {describe,expect,it} from 'vitest'
import {failureIdentity,safeFailureNote,workspaceFailureKey} from './tool-failure-learning.js'
import type {ToolRequest} from './tool-gateway.js'

const request=(command:string,extra:Record<string,unknown>={}):ToolRequest=>({version:1,workspaceId:'workspace_one',origin:'ui',tool:'terminal.run',arguments:{command,...extra}})

describe('tool failure identity',()=>{
  it('is deterministic, keyed, and excludes only explicit retry annotations',()=>{const key=Buffer.alloc(32,1),context={platform:'darwin' as const,arch:'arm64' as const},same=failureIdentity(key,request('make test',{failureOverrideReason:'fixed config'}),undefined,context),original=failureIdentity(key,request('make test'),undefined,context),otherKey=failureIdentity(Buffer.alloc(32,2),request('make test'),undefined,context);expect(same).toEqual(original);expect(otherKey.parameterFingerprint).not.toBe(original.parameterFingerprint);expect(JSON.stringify(original)).not.toContain('make test')})
  it('invalidates on material parameter, version, or context changes',()=>{const key=Buffer.alloc(32,3),darwin={platform:'darwin' as const,arch:'arm64' as const},base=failureIdentity(key,request('make test'),'1.0.0',darwin);expect(failureIdentity(key,request('make build'),'1.0.0',darwin).parameterFingerprint).not.toBe(base.parameterFingerprint);expect(failureIdentity(key,request('make test'),'2.0.0',darwin).capabilityVersion).not.toBe(base.capabilityVersion);expect(failureIdentity(key,request('make test'),'1.0.0',{platform:'win32',arch:'x64'}).contextDigest).not.toBe(base.contextDigest)})
  it('requires a protected-strength key and bounded readable notes',()=>{expect(()=>failureIdentity(Buffer.alloc(4),request('true'))).toThrow('failure_fingerprint_key_unavailable');expect(safeFailureNote('  changed   config ')).toBe('changed config');expect(()=>safeFailureNote('x'.repeat(301))).toThrow('invalid_failure_note')})
  it('derives the same enrolled-workspace key across peers and invalidates on key epoch rotation',()=>{const shared=Buffer.alloc(32,7).toString('base64'),first=workspaceFailureKey(shared,2),peer=workspaceFailureKey(shared,2),rotated=workspaceFailureKey(shared,3);expect(first).toEqual(peer);expect(rotated.capabilityVersion).not.toBe(first.capabilityVersion);expect(()=>workspaceFailureKey('bad',1)).toThrow('invalid_workspace_failure_key')})
})
