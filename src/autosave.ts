export type AutosaveState='idle'|'saving'|'saved'|'error'

export function closesEditedDocumentAfterDelete(kind:'document'|'chat'|'memory',deletedId:string,editingId?:string):boolean{
  return kind==='document'&&deletedId===editingId
}

export class DebouncedAutosave<T>{
  private timer:ReturnType<typeof setTimeout>|undefined
  private pending:T|undefined
  private generation=0
  private lastPersisted=''
  private active:Promise<void>=Promise.resolve()
  private readonly inFlight=new Map<string,Promise<void>>()
  constructor(private readonly identity:(value:T)=>string,private readonly delayMs=900,private readonly status:(state:AutosaveState,error?:string)=>void=()=>{}){}
  markPersisted(value:T):void{this.lastPersisted=this.identity(value);this.status('idle')}
  schedule(value:T,save:(value:T)=>Promise<void>):void{
    this.pending=value;this.generation+=1
    if(this.identity(value)===this.lastPersisted){this.clearTimer();this.status('saved');return}
    this.status('saving');this.clearTimer();const generation=this.generation
    this.timer=setTimeout(()=>{this.timer=undefined;void this.persist(value,save,generation).catch(()=>{})},this.delayMs)
  }
  async flush(value:T,save:(value:T)=>Promise<void>):Promise<void>{
    this.clearTimer();this.generation+=1
    if(this.identity(value)===this.lastPersisted){this.pending=undefined;this.status('saved');return}
    this.pending=value
    this.status('saving');await this.persist(value,save,this.generation)
  }
  hasPending():boolean{return this.pending!==undefined}
  async flushPending(save:(value:T)=>Promise<void>):Promise<boolean>{
    if(this.pending===undefined)return false
    const value=this.pending
    await this.flush(value,save)
    return true
  }
  cancel():void{this.clearTimer();this.pending=undefined;this.generation+=1;this.status('idle')}
  private clearTimer():void{if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined}}
  private async persist(value:T,save:(value:T)=>Promise<void>,generation:number):Promise<void>{
    const identity=this.identity(value),existing=this.inFlight.get(identity)
    if(existing){await existing;if(generation===this.generation)this.status('saved');return}
    const run=this.active.catch(()=>{}).then(async()=>{try{await save(value);this.lastPersisted=identity;if(generation===this.generation)this.status('saved')}catch(error){if(generation===this.generation)this.status('error',error instanceof Error?error.message:'Autosave failed');throw error}})
    this.inFlight.set(identity,run);this.active=run
    try{await run;if(this.pending!==undefined&&this.identity(this.pending)===identity)this.pending=undefined}finally{if(this.inFlight.get(identity)===run)this.inFlight.delete(identity)}
  }
}
