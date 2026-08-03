export type HistoryItem={id:string;title:string;updatedAt:string;messages?:Array<{body:string}>}
export type HistorySort='recent'|'title'
export type HistoryGroup={label:'Today'|'Yesterday'|'Previous 7 days'|'Earlier'|'A–Z';items:HistoryItem[]}

export function groupChatHistory(items:HistoryItem[],query:string,sort:HistorySort,now=new Date()):HistoryGroup[]{
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),day=86_400_000
  const needle=query.trim().toLocaleLowerCase()
  const filtered=items.filter((item)=>!needle||item.title.toLocaleLowerCase().includes(needle)||item.messages?.some((message)=>message.body.toLocaleLowerCase().includes(needle))).sort((left,right)=>sort==='title'?left.title.localeCompare(right.title):Date.parse(right.updatedAt)-Date.parse(left.updatedAt))
  if(sort==='title')return filtered.length?[{label:'A–Z',items:filtered}]:[]
  const groups=new Map<HistoryGroup['label'],HistoryItem[]>([['Today',[]],['Yesterday',[]],['Previous 7 days',[]],['Earlier',[]]])
  for(const item of filtered){const updated=new Date(item.updatedAt),itemStart=new Date(updated.getFullYear(),updated.getMonth(),updated.getDate()).getTime(),ageDays=Math.floor((start-itemStart)/day),label=ageDays<=0?'Today':ageDays===1?'Yesterday':ageDays<7?'Previous 7 days':'Earlier';groups.get(label)!.push(item)}
  return [...groups].map(([label,groupItems])=>({label,items:groupItems})).filter((group)=>group.items.length)
}
