import {describe,expect,it} from 'vitest'
import {extractRuleDirectives} from './learned-rules.js'

describe('local directive extraction',()=>{
  it('extracts only explicit directives with exact Unicode spans',()=>{const body='Discussion first.  Always preserve résumé accents! Never send automatically. Please use Markdown instead.';const items=extractRuleDirectives(body);expect(items.map((item)=>item.statement)).toEqual(['Always preserve résumé accents','Never send automatically','Please use Markdown instead']);for(const item of items)expect(body.slice(item.startOffset,item.endOffset)).toBe(item.excerpt)})
  it('rejects ordinary preferences and oversized input',()=>{expect(extractRuleDirectives('I usually like concise answers. Could you use Markdown?')).toEqual([]);expect(extractRuleDirectives(`Always ${'x'.repeat(100_000)}`)).toEqual([])})
})
