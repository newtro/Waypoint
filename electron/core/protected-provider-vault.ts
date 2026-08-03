import {chmodSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import path from 'node:path'

export type SecretProtector={available():boolean;encrypt(value:string):Buffer;decrypt(value:Buffer):string}
const KEY_PATTERN=/^[\x21-\x7e]{20,512}$/
export class ProtectedProviderVault{
  private readonly file:string
  constructor(root:string,private readonly protector:SecretProtector){const directory=path.join(root,'provider-secrets');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);this.file=path.join(directory,'openrouter.protected')}
  hasKey(){return existsSync(this.file)}
  setKey(value:string){if(!this.protector.available())throw new Error('OS protected secret storage is unavailable');if(!KEY_PATTERN.test(value)||/\s/.test(value))throw new Error('OpenRouter API key format is invalid');const temporary=`${this.file}.${process.pid}.tmp`;try{writeFileSync(temporary,this.protector.encrypt(value),{flag:'wx',mode:0o600});renameSync(temporary,this.file);chmodSync(this.file,0o600)}finally{rmSync(temporary,{force:true})}}
  getKey(){if(!this.hasKey())throw new Error('OpenRouter API key is not configured');if(!this.protector.available())throw new Error('OS protected secret storage is unavailable');const value=this.protector.decrypt(readFileSync(this.file));if(!KEY_PATTERN.test(value)||/\s/.test(value))throw new Error('Protected OpenRouter API key is invalid');return value}
  removeKey(){rmSync(this.file,{force:true})}
}
