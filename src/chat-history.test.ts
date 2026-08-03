import { describe,expect,it } from 'vitest'
import { groupChatHistory } from './chat-history.js'

const now=new Date('2026-08-03T12:00:00Z')
describe('chat history navigation',()=>{
  const chats=[{id:'today',title:'Zebra',updatedAt:'2026-08-03T09:00:00Z'},{id:'yesterday',title:'Alpha plan',updatedAt:'2026-08-02T09:00:00Z'},{id:'week',title:'Beta',updatedAt:'2026-07-30T09:00:00Z'},{id:'old',title:'Archive',updatedAt:'2026-07-01T09:00:00Z'}]
  it('groups recent history with stable user-facing periods',()=>expect(groupChatHistory(chats,'','recent',now).map((group)=>[group.label,group.items.map((item)=>item.id)])).toEqual([['Today',['today']],['Yesterday',['yesterday']],['Previous 7 days',['week']],['Earlier',['old']]]))
  it('filters titles and message content case-insensitively',()=>{const searchable=[...chats,{id:'content',title:'Unrelated',updatedAt:'2026-08-03T08:00:00Z',messages:[{body:'Project Wayfinder details'}]}];expect(groupChatHistory(searchable,'WAYFINDER','recent',now)[0].items[0].id).toBe('content');expect(groupChatHistory(chats,'nomatch','recent',now)).toEqual([])})
  it('uses one honest alphabetical group for A–Z sorting',()=>expect(groupChatHistory(chats,'','title',now).map((group)=>[group.label,group.items.map((item)=>item.title)])).toEqual([['A–Z',['Alpha plan','Archive','Beta','Zebra']]]))
})
