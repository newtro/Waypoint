export type VoiceState='off'|'listening'|'transcribing'|'thinking'|'speaking'|'error'
export type VoiceMode='push_to_talk'|'hands_free'
export type VoiceSnapshot={state:VoiceState;mode:VoiceMode;turn:number;partial:string;error?:string}

export class VoiceTurnManager{
  private snapshotValue:VoiceSnapshot={state:'off',mode:'push_to_talk',turn:0,partial:''}
  private generationCancel?:()=>void
  private speechCancel?:()=>void
  snapshot(){return{...this.snapshotValue}}
  start(mode:VoiceMode){this.stop();this.snapshotValue={state:'listening',mode,turn:this.snapshotValue.turn+1,partial:''};return this.snapshot()}
  partial(text:string,turn=this.snapshotValue.turn){if(turn!==this.snapshotValue.turn||!['listening','transcribing'].includes(this.snapshotValue.state))return false;this.snapshotValue={...this.snapshotValue,partial:text.slice(0,8_000)};return true}
  transcribe(turn=this.snapshotValue.turn){if(turn!==this.snapshotValue.turn||this.snapshotValue.state!=='listening')return false;this.snapshotValue={...this.snapshotValue,state:'transcribing'};return true}
  think(cancel:()=>void,turn=this.snapshotValue.turn){if(turn!==this.snapshotValue.turn||this.snapshotValue.state!=='transcribing')return false;this.generationCancel=cancel;this.snapshotValue={...this.snapshotValue,state:'thinking',partial:''};return true}
  speak(cancel:()=>void,turn=this.snapshotValue.turn){if(turn!==this.snapshotValue.turn||this.snapshotValue.state!=='thinking')return false;this.generationCancel=undefined;this.speechCancel=cancel;this.snapshotValue={...this.snapshotValue,state:'speaking'};return true}
  bargeIn(){if(!['thinking','speaking'].includes(this.snapshotValue.state))return false;this.generationCancel?.();this.speechCancel?.();this.generationCancel=undefined;this.speechCancel=undefined;this.snapshotValue={state:'listening',mode:this.snapshotValue.mode,turn:this.snapshotValue.turn+1,partial:''};return true}
  fail(code:string,turn=this.snapshotValue.turn){if(turn!==this.snapshotValue.turn)return false;this.generationCancel?.();this.speechCancel?.();this.generationCancel=undefined;this.speechCancel=undefined;this.snapshotValue={...this.snapshotValue,state:'error',partial:'',error:code.slice(0,120)};return true}
  stop(){this.generationCancel?.();this.speechCancel?.();this.generationCancel=undefined;this.speechCancel=undefined;this.snapshotValue={state:'off',mode:this.snapshotValue.mode,turn:this.snapshotValue.turn+1,partial:''};return this.snapshot()}
}
export class VoiceOperationRegistry{
 private readonly active=new Map<string,AbortController>()
 private key(workspaceId:string,chatId:string){return`${workspaceId}:${chatId}`}
 begin(workspaceId:string,chatId:string){this.stop(workspaceId,chatId);const controller=new AbortController();this.active.set(this.key(workspaceId,chatId),controller);return controller}
 finish(workspaceId:string,chatId:string,controller:AbortController){const key=this.key(workspaceId,chatId);if(this.active.get(key)===controller)this.active.delete(key)}
 stop(workspaceId:string,chatId?:string){let count=0;for(const[key,controller]of this.active)if(key.startsWith(`${workspaceId}:`)&&(!chatId||key===this.key(workspaceId,chatId))){controller.abort();this.active.delete(key);count++}return count}
 count(){return this.active.size}
}
