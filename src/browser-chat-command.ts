export type BrowserChatAction={command:'open';url:string}|{command:'snapshot';interactive?:boolean}|{command:'click';ref:string}|{command:'type';ref:string;text:string;sensitive:false}|{command:'select';ref:string;value:string}|{command:'upload';ref:string;files:string[]}|{command:'screenshot';name?:string}|{command:'wait';milliseconds:number}|{command:'close'}

const ref=(value:string)=>{if(!/^@e\d{1,6}$/.test(value))throw new Error('Use an element reference such as @e1.');return value}
export function parseBrowserChatCommand(value:string):BrowserChatAction|undefined{
  const input=value.trim();if(!/^\/(?:browser|browse)(?:\s|$)/i.test(input))return undefined
  const body=input.replace(/^\/(?:browser|browse)\s*/i,''),[commandRaw,...parts]=body.split(/\s+/),command=(commandRaw||'').toLowerCase()
  if(command==='open'||(!['snapshot','click','type','select','upload','screenshot','wait','close'].includes(command)&&/^https:\/\//i.test(body)))return{command:'open',url:command==='open'?parts.join(' '):body}
  if(command==='snapshot')return{command:'snapshot',interactive:parts[0]!=='full'}
  if(command==='click')return{command:'click',ref:ref(parts[0]??'')}
  if(command==='type'){const target=ref(parts.shift()??''),text=parts.join(' ');if(!text)throw new Error('Add non-secret text after the element reference.');return{command:'type',ref:target,text,sensitive:false}}
  if(command==='select'){const target=ref(parts.shift()??''),value=parts.join(' ');if(!value)throw new Error('Add a selection value.');return{command:'select',ref:target,value}}
  if(command==='upload'){const target=ref(parts.shift()??'');if(!parts.length)throw new Error('Add a workspace-relative file path.');return{command:'upload',ref:target,files:parts}}
  if(command==='screenshot')return{command:'screenshot',...(parts[0]?{name:parts[0]}:{})}
  if(command==='wait'){const milliseconds=Number(parts[0]);if(!Number.isSafeInteger(milliseconds))throw new Error('Wait requires milliseconds, for example /browser wait 1000.');return{command:'wait',milliseconds}}
  if(command==='close')return{command:'close'}
  throw new Error('Browser command: open, snapshot, click, type, select, upload, screenshot, wait, or close.')
}
