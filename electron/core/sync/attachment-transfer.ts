export interface EncryptedChunk {
  transferId: string
  attachmentId: string
  index: number
  total: number
  plaintextBytes: number
  ciphertext: Uint8Array
}

export interface ChunkCrypto {
  seal(plaintext: Uint8Array, associatedData: Uint8Array): Promise<Uint8Array>
  open(ciphertext: Uint8Array, associatedData: Uint8Array): Promise<Uint8Array>
}

const encoder = new TextEncoder()
function aad(transferId: string, attachmentId: string, index: number, total: number, plaintextBytes: number): Uint8Array {
  return encoder.encode(JSON.stringify([transferId, attachmentId, index, total, plaintextBytes]))
}
export async function decryptAttachmentChunk(chunk:EncryptedChunk,crypto:ChunkCrypto):Promise<Uint8Array>{if(!Number.isSafeInteger(chunk.total)||chunk.total<1||chunk.total>1024||!Number.isSafeInteger(chunk.index)||chunk.index<0||chunk.index>=chunk.total||!Number.isSafeInteger(chunk.plaintextBytes)||chunk.plaintextBytes<0||chunk.plaintextBytes>8*1024*1024||chunk.ciphertext.byteLength>8*1024*1024+65_536)throw new Error('Invalid encrypted attachment chunk');const plaintext=await crypto.open(chunk.ciphertext,aad(chunk.transferId,chunk.attachmentId,chunk.index,chunk.total,chunk.plaintextBytes));if(plaintext.byteLength!==chunk.plaintextBytes)throw new Error('Plaintext size mismatch');return plaintext}

export async function encryptAttachment(input: {
  transferId: string; attachmentId: string; bytes: Uint8Array; chunkBytes: number; crypto: ChunkCrypto
}): Promise<EncryptedChunk[]> {
  if (!input.transferId || !input.attachmentId) throw new Error('Transfer and attachment identities are required')
  if (!Number.isSafeInteger(input.chunkBytes) || input.chunkBytes < 1 || input.chunkBytes > 8 * 1024 * 1024) throw new Error('Invalid chunk bound')
  if(input.bytes.byteLength>128*1024*1024)throw new Error('Attachment exceeds Phase 3 transfer limit')
  const total = Math.max(1, Math.ceil(input.bytes.byteLength / input.chunkBytes)), chunks: EncryptedChunk[] = []
  for (let index = 0; index < total; index++) {
    const plaintext = input.bytes.slice(index * input.chunkBytes, Math.min((index + 1) * input.chunkBytes, input.bytes.byteLength))
    chunks.push({ transferId: input.transferId, attachmentId: input.attachmentId, index, total, plaintextBytes: plaintext.byteLength,
      ciphertext: await input.crypto.seal(plaintext, aad(input.transferId, input.attachmentId, index, total, plaintext.byteLength)) })
  }
  return chunks
}

export class AttachmentAssembler {
  private readonly received = new Map<number, Uint8Array>()
  private total: number | undefined
  private readonly limits:{maxPlaintextBytes:number;maxCiphertextBytes:number;maxChunks:number;maxTotalPlaintextBytes:number}
  constructor(private readonly transferId: string, private readonly attachmentId: string, private readonly crypto: ChunkCrypto,
    limits:Partial<{ maxPlaintextBytes:number;maxCiphertextBytes:number;maxChunks:number;maxTotalPlaintextBytes:number }> = {}, private readonly expectedSha256?:string) {
    this.limits={maxPlaintextBytes:8*1024*1024,maxCiphertextBytes:8*1024*1024+65_536,maxChunks:1024,maxTotalPlaintextBytes:128*1024*1024,...limits}
  }

  async accept(chunk: EncryptedChunk): Promise<boolean> {
    if (chunk.transferId !== this.transferId || chunk.attachmentId !== this.attachmentId) throw new Error('Chunk identity mismatch')
    if (!Number.isSafeInteger(chunk.total) || chunk.total < 1 || chunk.total>this.limits.maxChunks || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= chunk.total) throw new Error('Invalid chunk position')
    if (!Number.isSafeInteger(chunk.plaintextBytes) || chunk.plaintextBytes < 0 || chunk.plaintextBytes > this.limits.maxPlaintextBytes || chunk.ciphertext.byteLength > this.limits.maxCiphertextBytes) throw new Error('Chunk exceeds receiver bounds')
    if (this.total !== undefined && this.total !== chunk.total) throw new Error('Inconsistent transfer size')
    if (this.received.has(chunk.index)) return false
    const plaintext = await this.crypto.open(chunk.ciphertext, aad(chunk.transferId, chunk.attachmentId, chunk.index, chunk.total, chunk.plaintextBytes))
    if (plaintext.byteLength !== chunk.plaintextBytes) throw new Error('Plaintext size mismatch')
    this.total = chunk.total
    const acceptedBytes=[...this.received.values()].reduce((sum,value)=>sum+value.byteLength,0)+plaintext.byteLength
    if(acceptedBytes>this.limits.maxTotalPlaintextBytes)throw new Error('Transfer exceeds total receiver bound')
    this.received.set(chunk.index, plaintext)
    return true
  }

  missing(): number[] { return this.total === undefined ? [] : Array.from({ length: this.total }, (_, i) => i).filter((i) => !this.received.has(i)) }
  complete(): boolean { return this.total !== undefined && this.received.size === this.total }
  assemble(): Uint8Array {
    if (!this.complete()) throw new Error('Transfer is incomplete')
    const ordered = Array.from({ length: this.total! }, (_, i) => this.received.get(i)!), size = ordered.reduce((n, part) => n + part.byteLength, 0)
    const output = new Uint8Array(size); let offset = 0
    for (const part of ordered) { output.set(part, offset); offset += part.byteLength }
    if(this.expectedSha256&&createHash('sha256').update(output).digest('hex')!==this.expectedSha256)throw new Error('Attachment digest mismatch')
    return output
  }
}
import { createHash } from 'node:crypto'
