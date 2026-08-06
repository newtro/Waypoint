import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface DesktopHostDescriptor {
  mode: "desktop-host";
  endpoint: string;
  certificatePem: string;
}

export function validateDesktopHostDescriptor(
  value: unknown,
): asserts value is DesktopHostDescriptor {
  if (!value || typeof value !== "object")
    throw new Error("Desktop host descriptor is invalid");
  const item = value as Partial<DesktopHostDescriptor>;
  let endpoint: URL;
  try {
    endpoint = new URL(String(item.endpoint));
  } catch {
    throw new Error("Desktop host endpoint is invalid");
  }
  if (
    item.mode !== "desktop-host" ||
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    !endpoint.port ||
    (!["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname) &&
      isIP(endpoint.hostname) === 0) ||
    typeof item.certificatePem !== "string" ||
    item.certificatePem.length < 200 ||
    item.certificatePem.length > 20_000 ||
    !item.certificatePem.includes("BEGIN CERTIFICATE")
  )
    throw new Error("Desktop host descriptor is invalid");
}

export function createPinnedPeerFetch(
  descriptor: DesktopHostDescriptor,
): typeof fetch {
  validateDesktopHostDescriptor(descriptor);
  const origin = new URL(descriptor.endpoint).origin;
  return (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    if (url.origin !== origin)
      throw new Error("Desktop host request escaped its pinned origin");
    return await new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: init.method ?? "GET",
          headers: init.headers as Record<string, string> | undefined,
          ca: descriptor.certificatePem,
          rejectUnauthorized: true,
          servername:
            url.hostname === "127.0.0.1" || url.hostname === "::1"
              ? undefined
              : url.hostname,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 10 * 1024 * 1024) {
              request.destroy(
                new Error("Desktop host response exceeds bounds"),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 500,
                headers: response.headers as HeadersInit,
              }),
            ),
          );
        },
      );
      const abort = () =>
        request.destroy(new Error("Desktop host request canceled"));
      init.signal?.addEventListener("abort", abort, { once: true });
      request.once("error", reject);
      request.once("close", () =>
        init.signal?.removeEventListener("abort", abort),
      );
      if (init.body) {
        if (typeof init.body === "string" || init.body instanceof Uint8Array)
          request.write(init.body);
        else {
          request.destroy(new Error("Desktop host request body is invalid"));
          return;
        }
      }
      request.end();
    });
  }) as typeof fetch;
}
