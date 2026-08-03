import { describe, expect, it } from 'vitest'
import { AttachmentAssembler, encryptAttachment, type ChunkCrypto } from './attachment-transfer.js'
import { createHash } from 'node:crypto'

const crypto: ChunkCrypto = {
  async seal(bytes, aad) { return Uint8Array.from([...aad.slice(0, 2), ...bytes.map((value) => value ^ 0xaa)]) },
  async open(bytes) { return bytes.slice(2).map((value) => value ^ 0xaa) },
}

describe('bounded resumable attachment chunks', () => {
  it('accepts out-of-order chunks, ignores exact replay, and independently resumes gaps', async () => {
    const source = new TextEncoder().encode('a bounded attachment payload')
    const chunks = await encryptAttachment({ transferId: 'tx', attachmentId: 'file', bytes: source, chunkBytes: 7, crypto })
    expect(chunks.every((chunk) => chunk.plaintextBytes <= 7)).toBe(true)
    const assembler = new AttachmentAssembler('tx', 'file', crypto,{},createHash('sha256').update(source).digest('hex'))
    await assembler.accept(chunks[2]); await assembler.accept(chunks[0])
    expect(await assembler.accept(chunks[0])).toBe(false)
    expect(assembler.missing()).toContain(1)
    for (const chunk of chunks) await assembler.accept(chunk)
    expect(assembler.complete()).toBe(true)
    expect(assembler.assemble()).toEqual(source)
    const wrongDigest=new AttachmentAssembler('tx','file',crypto,{},'00'.repeat(32));for(const chunk of chunks)await wrongDigest.accept(chunk)
    expect(()=>wrongDigest.assemble()).toThrow('digest')
  })

  it('binds encrypted chunks to transfer metadata and rejects inconsistent transfers', async () => {
    const [chunk] = await encryptAttachment({ transferId: 'tx', attachmentId: 'file', bytes: new Uint8Array([1]), chunkBytes: 1, crypto })
    await expect(new AttachmentAssembler('other', 'file', crypto).accept(chunk)).rejects.toThrow('identity')
    const assembler = new AttachmentAssembler('tx', 'file', crypto)
    await assembler.accept(chunk)
    await expect(assembler.accept({ ...chunk, index: 1, total: 2 })).rejects.toThrow('Inconsistent')
    await expect(new AttachmentAssembler('tx', 'file', crypto, { maxPlaintextBytes: 0, maxCiphertextBytes: 1 }).accept(chunk)).rejects.toThrow('bounds')
    await expect(new AttachmentAssembler('tx','file',crypto,{maxChunks:0}).accept(chunk)).rejects.toThrow('position')
  })
})
