export function providerFormField(field:Record<string,unknown>):{multiple:boolean;options:string[]}{
  const items=field.items&&typeof field.items==='object'&&!Array.isArray(field.items)?field.items as Record<string,unknown>:{}
  const source=Array.isArray(field.enum)?field.enum:Array.isArray(field.oneOf)?field.oneOf:Array.isArray(items.enum)?items.enum:Array.isArray(items.anyOf)?items.anyOf:[]
  return{multiple:field.type==='array',options:source.map((item)=>String(item&&typeof item==='object'&&!Array.isArray(item)?(item as Record<string,unknown>).const??(item as Record<string,unknown>).title:item))}
}

export function providerFormRequiredReady(required:string[],values:Record<string,unknown>):boolean{return required.every((key)=>{const value=values[key];return Array.isArray(value)?value.length>0:value!==undefined&&String(value).trim()!==''})}
