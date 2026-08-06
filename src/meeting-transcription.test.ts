import{describe,expect,it}from'vitest'
import{meetingWavSegments}from'./meeting-transcription.js'
describe('meeting transcription segmentation',()=>{it('downmixes and bounds local PCM segments',()=>{const left=new Float32Array(25).fill(.5),right=new Float32Array(25).fill(-.5),segments=[...meetingWavSegments({sampleRate:8_000,numberOfChannels:2,length:25,getChannelData:(channel:number)=>channel?right:left}as AudioBuffer,.002)];expect(segments).toHaveLength(2);expect(segments[0].byteLength).toBe(44+32);expect(new DataView(segments[0].buffer).getInt16(44,true)).toBe(0)})})
