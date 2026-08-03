import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {WorkspaceStore} from '../dist-electron/electron/core/store.js'
import {writeAtomicBackup} from '../dist-electron/electron/core/backup.js'
import {runBackupAdministration} from '../dist-electron/electron/core/backup-administration-runner.js'

const root=mkdtempSync(path.join(tmpdir(),'waypoint-worker-proof-'))
try{
  const store=new WorkspaceStore(path.join(root,'live.sqlite')),workspace=store.createWorkspace('Worker proof',root),file=path.join(root,'proof.json')
  store.createDocument(workspace.id,'Proof','compiled off-main worker')
  writeAtomicBackup(file,store.exportWorkspace(workspace.id))
  store.close()
  const verify=await runBackupAdministration('verify',file),drill=await runBackupAdministration('drill',file)
  if(verify.status!=='passed'||drill.status!=='passed'||!drill.drill?.temporaryDataRemoved)throw new Error('Compiled backup worker verification failed')
  process.stdout.write(`Compiled backup worker verified: inspect=${verify.status}, drill=${drill.status}, cleanup=${drill.drill.temporaryDataRemoved}\n`)
}finally{rmSync(root,{recursive:true,force:true})}
