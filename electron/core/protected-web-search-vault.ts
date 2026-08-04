import{chmodSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync}from'node:fs'
import path from'node:path'
import type{SecretProtector}from'./protected-provider-vault.js'
const KEY=/^[\x21-\x7e]{20,512}$/
export class ProtectedWebSearchVault{
  private readonly file:string
  constructor(root:string,private readonly protector:SecretProtector){const directory=path.join(root,'provider-secrets');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);this.file=path.join(directory,'brave-search.protected')}
  hasKey(){if(!existsSync(this.file)||!this.protector.available())return false;try{const value=this.protector.decrypt(readFileSync(this.file));return KEY.test(value)&&!/\s/.test(value)}catch{return false}}
  setKey(value:string){if(!this.protector.available())throw new Error('OS protected secret storage is unavailable');if(!KEY.test(value)||/\s/.test(value))throw new Error('Brave Search API key format is invalid');const temporary=`${this.file}.${process.pid}.tmp`;try{writeFileSync(temporary,this.protector.encrypt(value),{flag:'wx',mode:0o600});renameSync(temporary,this.file);chmodSync(this.file,0o600)}finally{rmSync(temporary,{force:true})}}
  getKey(){if(!existsSync(this.file))throw new Error('Brave Search API key is not configured');if(!this.protector.available())throw new Error('OS protected secret storage is unavailable');const value=this.protector.decrypt(readFileSync(this.file));if(!KEY.test(value)||/\s/.test(value))throw new Error('Protected Brave Search API key is invalid');return value}
  removeKey(){rmSync(this.file,{force:true})}
}
