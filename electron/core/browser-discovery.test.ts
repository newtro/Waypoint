import{describe,expect,it}from'vitest';import{browserCandidates}from'./browser-discovery.js'
describe('browser discovery',()=>{it('makes Brave first class and Firefox fail closed',()=>{const values=browserCandidates('darwin');expect(values.map((item)=>item.id)).toEqual(['brave','chrome','edge','firefox']);expect(values.find((item)=>item.id==='firefox')?.selectable).toBe(false)})})
