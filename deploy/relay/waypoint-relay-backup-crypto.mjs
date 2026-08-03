import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'

const [mode,input,output,keyPath]=process.argv.slice(2),magic=Buffer.from('WPBK0001')
if(!['encrypt','decrypt'].includes(mode)||!input||!output||!keyPath)throw new Error('Invalid backup crypto arguments')
const encoded=readFileSync(keyPath,'utf8').trim()
if(!/^[a-f0-9]{64}$/.test(encoded))throw new Error('Invalid backup key')
const key=Buffer.from(encoded,'hex'),source=readFileSync(input)
if(mode==='encrypt'){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(magic);const ciphertext=Buffer.concat([cipher.update(source),cipher.final()]),tag=cipher.getAuthTag();writeFileSync(output,Buffer.concat([magic,nonce,tag,ciphertext]),{mode:0o600})
}else{
  if(source.length<36||!source.subarray(0,8).equals(magic))throw new Error('Invalid backup format');const nonce=source.subarray(8,20),tag=source.subarray(20,36),ciphertext=source.subarray(36),decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(magic);decipher.setAuthTag(tag);writeFileSync(output,Buffer.concat([decipher.update(ciphertext),decipher.final()]),{mode:0o600})
}
