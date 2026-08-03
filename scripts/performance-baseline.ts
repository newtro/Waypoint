import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { WorkspaceStore } from '../electron/core/store.js'

const scale=Math.max(1,Math.min(10,Number(process.env.WAYPOINT_PERF_SCALE??1)))
const fixture={documents:1_000*scale,messages:2_000*scale,memories:500*scale,edges:1_000*scale,indexedDocuments:250*scale,attachments:100*scale}
const budgets={startupMilliseconds:1_000,reopenMilliseconds:1_000,searchP95Milliseconds:200,indexP95Milliseconds:20,attachmentP95Milliseconds:20,graphMilliseconds:750,diagnosticsMilliseconds:2_000,databaseBytes:128*1024*1024*scale,bytesPerCanonicalObject:32*1024}
const measure=<T>(operation:()=>T):{milliseconds:number;value:T}=>{const started=performance.now(),value=operation();return{milliseconds:performance.now()-started,value}}
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]
const root=mkdtempSync(path.join(tmpdir(),'waypoint-performance-')),database=path.join(root,'waypoint.sqlite')
const started=measure(()=>new WorkspaceStore(database));let store=started.value
const workspace=store.createWorkspace('Performance fixture',root),seedStarted=performance.now(),documents:string[]=[]
for(let index=0;index<fixture.documents;index+=1)documents.push(store.createDocument(workspace.id,`Waypoint note ${index}`,`Representative lifecycle recovery security search token-${index}`).id)
for(let index=0;index<fixture.messages/10;index+=1){const chat=store.createChat(workspace.id,`Chat ${index}`);for(let message=0;message<10;message+=1)store.addMessage(workspace.id,chat,'user',`Durable message ${message} route ${index}`)}
const memories:string[]=[];for(let index=0;index<fixture.memories;index+=1)memories.push(store.createMemory(workspace.id,`Memory ${index}`,`Retrieval fact ${index}`))
for(let index=0;index<fixture.edges;index+=1)store.createRelationship(workspace.id,documents[index%documents.length],memories[index%memories.length],`supports-${Math.floor(index/memories.length)}`)
const provenance={provider:'performance',providerVersion:'1',model:'fixture',modelDigest:'fixture-v1',chunkingDigest:'whole-v1'}
const indexing=documents.slice(0,fixture.indexedDocuments).map((objectId,index)=>measure(()=>store.indexEmbedding(workspace.id,{objectId,objectKind:'document'},Array.from({length:32},(_,dimension)=>(index+dimension)%17),provenance)).milliseconds)
const attachmentSource=path.join(root,'performance.txt');writeFileSync(attachmentSource,'bounded attachment fixture')
const attachmentTimes=documents.slice(0,fixture.attachments).map((objectId,index)=>measure(()=>store.addAttachment(workspace.id,objectId,`fixture-${index}.txt`,'text/plain',attachmentSource)).milliseconds)
const seedMilliseconds=performance.now()-seedStarted
const searches=Array.from({length:50},(_,index)=>measure(()=>store.searchText(workspace.id,`token-${index*7}`)).milliseconds)
const graph=measure(()=>store.graph(workspace.id)),diagnostics=measure(()=>store.localDiagnostics(workspace.id))
store.close();const reopened=measure(()=>new WorkspaceStore(database));store=reopened.value
const databaseBytes=statSync(database).size,canonicalObjects=fixture.documents+fixture.messages+fixture.memories+fixture.edges+fixture.attachments
const report={formatVersion:2,platform:process.platform,arch:process.arch,node:process.version,scale,fixture,startupMilliseconds:started.milliseconds,reopenMilliseconds:reopened.milliseconds,seedMilliseconds,searchP95Milliseconds:percentile(searches,.95),indexP95Milliseconds:percentile(indexing,.95),attachmentP95Milliseconds:percentile(attachmentTimes,.95),graphMilliseconds:graph.milliseconds,diagnosticsMilliseconds:diagnostics.milliseconds,databaseBytes,bytesPerCanonicalObject:databaseBytes/canonicalObjects,budgets}
store.close();process.stdout.write(`${JSON.stringify(report,null,2)}\n`)
const failures=(Object.keys(budgets) as Array<keyof typeof budgets>).filter((key)=>report[key]>budgets[key]);if(failures.length){process.stderr.write(`Performance budgets exceeded: ${failures.join(', ')}\n`);process.exitCode=1}
