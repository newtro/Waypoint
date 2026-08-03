import {createHash} from 'node:crypto'

export const MAX_MEETING_AUDIO_BYTES=100*1024*1024
export const MAX_MEETING_TRANSCRIPT_CHARACTERS=500_000
export const MEETING_MEDIA_TYPES=['audio/webm','audio/mp4','audio/ogg','audio/wav'] as const

export function validateMeetingAudio(mediaType:string,bytes:Buffer):{sha256:string;extension:string}{
  if(!(MEETING_MEDIA_TYPES as readonly string[]).includes(mediaType))throw new Error('Unsupported meeting audio type')
  if(!bytes.length)throw new Error('Meeting audio is empty')
  if(bytes.length>MAX_MEETING_AUDIO_BYTES)throw new Error(`Meeting audio exceeds ${MAX_MEETING_AUDIO_BYTES} bytes`)
  const signatures:Record<string,(value:Buffer)=>boolean>={'audio/webm':(value)=>value.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])),'audio/mp4':(value)=>value.length>=12&&value.subarray(4,8).toString('ascii')==='ftyp','audio/ogg':(value)=>value.subarray(0,4).toString('ascii')==='OggS','audio/wav':(value)=>value.subarray(0,4).toString('ascii')==='RIFF'&&value.subarray(8,12).toString('ascii')==='WAVE'}
  if(!signatures[mediaType](bytes))throw new Error('Meeting audio signature does not match its media type')
  return{sha256:createHash('sha256').update(bytes).digest('hex'),extension:mediaType==='audio/webm'?'webm':mediaType==='audio/mp4'?'m4a':mediaType==='audio/ogg'?'ogg':'wav'}
}

export function validateTranscript(value:string):string{const transcript=value.trim();if(!transcript)throw new Error('Transcript draft is empty');if(transcript.length>MAX_MEETING_TRANSCRIPT_CHARACTERS)throw new Error('Transcript draft is too long');if(transcript.includes('\0'))throw new Error('Transcript draft contains invalid characters');return transcript}
