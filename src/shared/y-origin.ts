import * as Y from "yjs";

export const YJS_ORIGIN_REMOTE = "remote";
export const YJS_ORIGIN_STORAGE = "storage";

export function isInboundYjsOrigin(origin: unknown): boolean {
  return origin === YJS_ORIGIN_REMOTE || origin === YJS_ORIGIN_STORAGE;
}

export function shouldSendYjsUpdate(origin: unknown, connectionLive: boolean): boolean {
  return connectionLive && !isInboundYjsOrigin(origin);
}

export function applyRemoteYjsUpdate(doc: Y.Doc, update: Uint8Array): void {
  if (update.byteLength === 0) {
    return;
  }
  Y.applyUpdate(doc, update, YJS_ORIGIN_REMOTE);
}
