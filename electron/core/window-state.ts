export type WindowBounds={x:number;y:number;width:number;height:number}
export type SavedWindowState={bounds:WindowBounds;displayId:string;maximized:boolean}
export type DisplayArea={id:string;workArea:WindowBounds}

const MIN_VISIBLE=96

function finiteBounds(value:unknown):value is WindowBounds{
  if(!value||typeof value!=='object')return false
  const candidate=value as Record<string,unknown>
  return ['x','y','width','height'].every((key)=>Number.isFinite(candidate[key]))&&Number(candidate.width)>=840&&Number(candidate.height)>=620
}

function overlap(a:WindowBounds,b:WindowBounds):number{
  return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
}

function distance(a:WindowBounds,b:WindowBounds):number{
  return Math.hypot((a.x+a.width/2)-(b.x+b.width/2),(a.y+a.height/2)-(b.y+b.height/2))
}

export function isEffectivelyMaximized(bounds:WindowBounds,workArea:WindowBounds,tolerance=8):boolean{
  return Math.abs(bounds.x-workArea.x)<=tolerance&&Math.abs(bounds.y-workArea.y)<=tolerance&&Math.abs(bounds.width-workArea.width)<=tolerance&&Math.abs(bounds.height-workArea.height)<=tolerance
}

export function restoreWindowState(value:unknown,displays:DisplayArea[],fallback:WindowBounds):SavedWindowState{
  if(!value||typeof value!=='object'||!displays.length)return{bounds:fallback,displayId:displays[0]?.id??'',maximized:false}
  const candidate=value as Partial<SavedWindowState>
  if(!finiteBounds(candidate.bounds))return{bounds:fallback,displayId:displays[0].id,maximized:false}
  const target=displays.find((display)=>display.id===String(candidate.displayId))??displays.reduce((best,display)=>{const displayOverlap=overlap(candidate.bounds!,display.workArea),bestOverlap=overlap(candidate.bounds!,best.workArea);return displayOverlap>bestOverlap||(displayOverlap===bestOverlap&&distance(candidate.bounds!,display.workArea)<distance(candidate.bounds!,best.workArea))?display:best})
  const visible=overlap(candidate.bounds,target.workArea)
  if(visible<MIN_VISIBLE*MIN_VISIBLE){
    const width=Math.min(Math.max(candidate.bounds.width,840),target.workArea.width)
    const height=Math.min(Math.max(candidate.bounds.height,620),target.workArea.height)
    return{bounds:{x:target.workArea.x+Math.round((target.workArea.width-width)/2),y:target.workArea.y+Math.round((target.workArea.height-height)/2),width,height},displayId:target.id,maximized:Boolean(candidate.maximized)}
  }
  return{bounds:candidate.bounds,displayId:target.id,maximized:Boolean(candidate.maximized)}
}
