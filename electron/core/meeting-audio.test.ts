import {describe,expect,it} from 'vitest'
import {MAX_MEETING_AUDIO_BYTES,validateMeetingAudio,validateTranscript} from './meeting-audio.js'

describe('meeting audio boundary',()=>{
  it('accepts matching bounded media and rejects malformed or oversized input',()=>{expect(validateMeetingAudio('audio/webm',Buffer.from([0x1a,0x45,0xdf,0xa3,1]))).toMatchObject({extension:'webm'});expect(()=>validateMeetingAudio('audio/webm',Buffer.from('private text'))).toThrow(/signature/);expect(()=>validateMeetingAudio('audio/webm',Buffer.alloc(MAX_MEETING_AUDIO_BYTES+1))).toThrow(/exceeds/)})
  it('bounds transcript drafts',()=>{expect(validateTranscript(' Speaker 1?: hello ')).toBe('Speaker 1?: hello');expect(()=>validateTranscript('\0')).toThrow()})
})
