import{describe,expect,it}from'vitest'
import{providerFormField,providerFormRequiredReady}from'./provider-form.js'

describe('provider form schema helpers',()=>{
  it('preserves official MCP multi-select arrays and titled options',()=>{expect(providerFormField({type:'array',items:{type:'string',enum:['alice','bob']},minItems:1})).toEqual({multiple:true,options:['alice','bob']});expect(providerFormField({type:'array',items:{anyOf:[{const:'a',title:'Alice'},{const:'b',title:'Bob'}]}})).toEqual({multiple:true,options:['a','b']});expect(providerFormRequiredReady(['reviewers'],{reviewers:['alice']})).toBe(true);expect(providerFormRequiredReady(['reviewers'],{reviewers:[]})).toBe(false)})
})
