for (const name of [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "WebTransport",
  "TCPSocket",
  "UDPSocket",
]) {
  try {
    globalThis[name] = undefined;
    Object.defineProperty(globalThis, name, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch {
    // A non-configurable transport fails closed at the runtime readiness probe.
  }
}
