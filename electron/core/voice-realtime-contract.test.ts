import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest'
describe('voice realtime renderer contract',()=>{
 const source=readFileSync(new URL('../../src/main.tsx',import.meta.url),'utf8')
 it('arms speaking before IPC and synchronously leaves speaking before completion capture',()=>{const arm=source.indexOf("voiceStateRef.current='speaking';setVoiceState('speaking');void window.waypoint.speakVoice"),terminal=source.indexOf("voiceStateRef.current='listening';setVoiceState('listening');setVoicePartial('Listening…');void startVoiceCapture(true)");expect(arm).toBeGreaterThan(0);expect(terminal).toBeGreaterThan(0);expect(source).toContain("if(turn!==voiceTurnRef.current||voiceStateRef.current!=='speaking')return")})
 it('dispatches native stop before any monitor teardown and scope changes invalidate both capture paths',()=>{expect(source).toContain("const target={workspaceId:workspace.id,chatId:selectedChat.id},stop=window.waypoint.stopVoice");expect(source).toContain("await stop;if(turn!==voiceTurnRef.current");expect(source).toContain('void voiceCaptureRef.current.cancel();void voiceMonitorRef.current.stop()')})
})
