import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "node:https";
import { request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import path from "node:path";
import selfsigned from "selfsigned";
import { createRelayServer } from "../../../node/relay/server.js";
import type { ProtectedWorkspaceSecrets } from "./protected-sync-vault.js";
import type { ProtectedSyncVault } from "./protected-sync-vault.js";
import type { DesktopHostDescriptor } from "./peer-host-transport.js";

const MAX_PROXY_BODY = 10 * 1024 * 1024;
export interface PeerHostStatus {
  running: boolean;
  mode: "desktop-host";
  endpoint?: string;
  reason: string;
  startedAt?: string;
  fingerprintSha256?: string;
  workspaceId?: string;
  identityRotated?: boolean;
}

export class PeerHostRuntime {
  private external?: HttpsServer;
  private internal?: Awaited<ReturnType<typeof createRelayServer>>;
  private current?: PeerHostStatus;
  private transition: Promise<void> = Promise.resolve();
  constructor(
    private readonly root: string,
    private readonly vault: ProtectedSyncVault,
  ) {}
  status(): PeerHostStatus {
    return (
      this.current ?? {
        running: false,
        mode: "desktop-host",
        reason:
          "Desktop host is stopped. Peers wait locally unless optional relay fallback is configured.",
      }
    );
  }
  async start(
    active: ProtectedWorkspaceSecrets,
    bindAddress?: string,
  ): Promise<PeerHostStatus & { descriptor: DesktopHostDescriptor }> {
    return this.serialize(() => this.startUnlocked(active, bindAddress));
  }
  private async startUnlocked(
    active: ProtectedWorkspaceSecrets,
    bindAddress?: string,
  ): Promise<PeerHostStatus & { descriptor: DesktopHostDescriptor }> {
    if (this.external) throw new Error("Desktop host is already running");
    const workspaceRoot = path.join(this.root, active.workspaceId);
    mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    const registry = path.join(workspaceRoot, "authority.json"),
      webhookKey = path.join(workspaceRoot, "webhook.key"),
      database = path.join(workspaceRoot, "peer-host.sqlite");
    writeFileSync(
      registry,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            workspaceId: active.workspaceId,
            keyEpoch: active.keyEpoch,
            devices: [
              {
                deviceId: active.device.deviceId,
                signingPublicKey: active.device.signingPublicKey,
                encryptionPublicKey: active.device.encryptionPublicKey,
                role: "owner",
                active: true,
              },
            ],
          },
        ],
      }),
      { mode: 0o600 },
    );
    try {
      writeFileSync(webhookKey, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const previousEndpoint =
        active.transport?.mode === "desktop-host"
          ? new URL(active.transport.endpoint)
          : undefined,
      address =
        bindAddress ??
        (previousEndpoint && addressAvailable(previousEndpoint.hostname)
          ? previousEndpoint.hostname
          : preferredLanAddress()),
      storedIdentity = this.vault.loadHostIdentity(active.workspaceId),
      reusableIdentity =
        storedIdentity &&
        certificateUsable(storedIdentity.certificatePem, address)
          ? storedIdentity
          : undefined,
      generated = reusableIdentity
        ? undefined
        : await selfsigned.generate(
            [{ name: "commonName", value: "Waypoint Desktop Host" }],
            {
              keySize: 2048,
              days: 365,
              algorithm: "sha256",
              extensions: [
                { name: "basicConstraints", cA: false },
                {
                  name: "keyUsage",
                  digitalSignature: true,
                  keyEncipherment: true,
                },
                {
                  name: "subjectAltName",
                  altNames: [
                    { type: 7, ip: address },
                    { type: 7, ip: "127.0.0.1" },
                  ],
                },
              ],
            },
          );
    if (generated)
      this.vault.saveHostIdentity({
        version: 1,
        workspaceId: active.workspaceId,
        certificatePem: generated.cert,
        privateKeyPem: generated.private,
      });
    const certificatePem = reusableIdentity?.certificatePem ?? generated!.cert,
      privateKeyPem = reusableIdentity?.privateKeyPem ?? generated!.private;
    const internal = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      databasePath: database,
      authorityRegistryPath: registry,
      webhookKeyPath: webhookKey,
      tlsMode: "proxy-loopback",
      logLevel: "warn",
    });
    let internalPort: number;
    try {
      internalPort = await listen(internal.server, "127.0.0.1");
    } catch (error) {
      await close(internal.server);
      throw error;
    }
    this.internal = internal;
    const external = createHttpsServer(
      { key: privateKeyPem, cert: certificatePem },
      (request, response) => {
        if (!request.url) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end('{"error":"not_found"}');
          return;
        }
        let bytes = 0;
        const proxy = httpRequest(
          {
            host: "127.0.0.1",
            port: internalPort,
            path: request.url,
            method: request.method,
            headers: { ...request.headers, host: `127.0.0.1:${internalPort}` },
          },
          (upstream) => {
            response.writeHead(upstream.statusCode ?? 502, upstream.headers);
            upstream.pipe(response);
          },
        );
        request.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_PROXY_BODY) {
            proxy.destroy();
            request.destroy();
            return;
          }
          proxy.write(chunk);
        });
        request.on("end", () => proxy.end());
        request.on("error", () => proxy.destroy());
        proxy.on("error", () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
      },
    );
    let port: number;
    try {
      port = await listen(
        external,
        address,
        previousEndpoint && previousEndpoint.hostname === address
          ? Number(previousEndpoint.port)
          : 0,
      );
    } catch (error) {
      await Promise.all([close(external), close(internal.server)]);
      this.internal = undefined;
      throw error;
    }
    this.external = external;
    const descriptor = {
      mode: "desktop-host" as const,
      endpoint: `https://${address}:${port}`,
      certificatePem,
    };
    this.current = {
      running: true,
      mode: "desktop-host",
      endpoint: descriptor.endpoint,
      reason:
        storedIdentity && !reusableIdentity
          ? "Desktop host identity rotated after its saved network address or certificate became unusable. Create new peer invitations and webhook sender configurations so clients can pin this identity."
          : "This desktop is hosting authenticated peer transport and signed inbound webhooks on the local network. If it sleeps or quits, delivery pauses unless optional relay fallback is enabled.",
      startedAt: new Date().toISOString(),
      fingerprintSha256: createHash("sha256")
        .update(new X509Certificate(certificatePem).raw)
        .digest("hex"),
      workspaceId: active.workspaceId,
      identityRotated: Boolean(storedIdentity && !reusableIdentity),
    };
    return { ...this.current, descriptor };
  }
  async stop() {
    return this.serialize(() => this.stopUnlocked());
  }
  private async stopUnlocked() {
    const external = this.external,
      internal = this.internal;
    await Promise.all([close(external), close(internal?.server)]);
    this.external = undefined;
    this.internal = undefined;
    this.current = {
      running: false,
      mode: "desktop-host",
      reason:
        "Desktop host is stopped. Peers wait locally unless optional relay fallback is configured.",
    };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
function preferredLanAddress() {
  for (const records of Object.values(networkInterfaces()))
    for (const item of records ?? [])
      if (
        item.family === "IPv4" &&
        !item.internal &&
        /^192\.168\.|^10\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(item.address)
      )
        return item.address;
  return "127.0.0.1";
}
function addressAvailable(address: string) {
  return (
    address === "127.0.0.1" ||
    Object.values(networkInterfaces()).some((records) =>
      records?.some((item) => item.address === address),
    )
  );
}
function certificateUsable(pem: string, address: string) {
  try {
    const certificate = new X509Certificate(pem);
    return (
      Boolean(certificate.checkIP(address)) &&
      Date.parse(certificate.validTo) > Date.now() + 30 * 24 * 60 * 60_000
    );
  } catch {
    return false;
  }
}
function listen(
  server: {
    listen(port: number, host: string, callback: () => void): unknown;
    address(): unknown;
  },
  host: string,
  port = 0,
) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    (
      server as unknown as {
        once(event: string, listener: (error: Error) => void): void;
      }
    ).once("error", onError);
    server.listen(port, host, () => {
      const address = server.address() as { port: number };
      resolve(address.port);
    });
  });
}
function close(server?: { close(callback: (error?: Error) => void): void }) {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
