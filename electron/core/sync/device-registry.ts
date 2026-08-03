import type { DeviceIdentity, DeviceRecord, EnrollmentApproval, EnrollmentRequest, PresenceRecord } from './types.js'
import { WaypointCrypto } from './crypto.js'

export class DeviceRegistry {
  private readonly records = new Map<string, DeviceRecord>()
  private readonly presence = new Map<string, PresenceRecord>()

  constructor(private readonly crypto: WaypointCrypto,private readonly ledger:{hasEnrollment(requestId:string):boolean;consumeEnrollment(requestId:string):void}) {}

  bootstrapOwner(workspaceId:string,owner:DeviceIdentity,now=new Date()):DeviceRecord{
    if([...this.records.values()].some((record)=>record.workspaceId===workspaceId))throw new Error('Workspace already has an enrolled owner')
    const record:DeviceRecord={...owner,workspaceId,enrolledAt:now.toISOString(),membershipEpoch:1};this.records.set(owner.deviceId,record);return {...record}
  }

  enroll(request: EnrollmentRequest, approval:EnrollmentApproval, now = new Date()): DeviceRecord {
    if (!this.crypto.verifyEnrollmentRequest(request, now)) throw new Error('Enrollment request is invalid or expired')
    if (this.ledger.hasEnrollment(request.requestId)) throw new Error('Enrollment request was already consumed')
    const owner=this.records.get(approval.ownerDeviceId)
    const approvedAt=Date.parse(approval.approvedAt)
    if(!owner||owner.workspaceId!==request.workspaceId||owner.revokedAt||owner.membershipEpoch!==approval.membershipEpoch||approval.requestId!==request.requestId||approval.workspaceId!==request.workspaceId||!Number.isFinite(approvedAt)||approvedAt>now.getTime()+30_000||approvedAt<Date.parse(request.createdAt)||!this.crypto.verifyEnrollmentApproval(approval,owner))throw new Error('Active owner approval is required')
    const existing = this.records.get(request.device.deviceId)
    if (existing && existing.workspaceId !== request.workspaceId) throw new Error('Device is already enrolled in another workspace')
    if (existing && (existing.signingPublicKey !== request.device.signingPublicKey ||
      existing.encryptionPublicKey !== request.device.encryptionPublicKey)) throw new Error('Device identity key mismatch')
    if (existing?.revokedAt) throw new Error('Revoked device cannot be re-enrolled with the same identity')
    const record: DeviceRecord = existing ?? {
      ...request.device,
      workspaceId: request.workspaceId,
      enrolledAt: now.toISOString(),
      membershipEpoch: 1,
    }
    this.ledger.consumeEnrollment(request.requestId)
    this.records.set(record.deviceId, record)
    return { ...record }
  }

  revoke(workspaceId: string, deviceId: string, now = new Date()): DeviceRecord {
    const record = this.require(workspaceId, deviceId)
    if (!record.revokedAt) { record.revokedAt = now.toISOString(); record.membershipEpoch += 1 }
    this.presence.delete(deviceId)
    return { ...record }
  }

  heartbeat(workspaceId: string, deviceId: string, now = new Date(), ttlMs = 90_000): PresenceRecord {
    const record = this.require(workspaceId, deviceId)
    if (record.revokedAt) throw new Error('Revoked device cannot publish presence')
    record.lastSeenAt = now.toISOString()
    const value = { deviceId, observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() }
    this.presence.set(deviceId, value)
    return { ...value }
  }

  activePresence(workspaceId: string, now = new Date()): PresenceRecord[] {
    return [...this.presence.values()].filter((item) => {
      const record = this.records.get(item.deviceId)
      return record?.workspaceId === workspaceId && !record.revokedAt && Date.parse(item.expiresAt) > now.getTime()
    }).map((item) => ({ ...item }))
  }

  get(workspaceId: string, deviceId: string): DeviceRecord | undefined {
    const record = this.records.get(deviceId)
    return record?.workspaceId === workspaceId ? { ...record } : undefined
  }

  isActive(workspaceId:string, deviceId:string): boolean {
    const record=this.records.get(deviceId)
    return record?.workspaceId===workspaceId && !record.revokedAt
  }
  isActiveAtEpoch(workspaceId:string,deviceId:string,membershipEpoch:number):boolean{
    const record=this.records.get(deviceId)
    return record?.workspaceId===workspaceId&&!record.revokedAt&&record.membershipEpoch===membershipEpoch
  }

  private require(workspaceId: string, deviceId: string): DeviceRecord {
    const record = this.records.get(deviceId)
    if (!record || record.workspaceId !== workspaceId) throw new Error('Device is not enrolled in this workspace')
    return record
  }
}
