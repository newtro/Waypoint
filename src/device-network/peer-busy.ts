export function isDevicePeerBusy(
  busy: string | undefined,
  peer: { deviceId: string; pairing?: { sessionId: string } },
) {
  return (
    busy === peer.deviceId ||
    Boolean(peer.pairing && busy === peer.pairing.sessionId)
  );
}
