import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";
import { MSG_AWARENESS, MSG_SYNC, SYNC_STEP1, SYNC_STEP2, SYNC_UPDATE } from "./protocol";

export type ParsedYjsMessage =
  | { kind: "sync-step1"; decoder: decoding.Decoder }
  | { kind: "sync-payload"; syncType: typeof SYNC_STEP2 | typeof SYNC_UPDATE; update: Uint8Array }
  | { kind: "awareness"; update: Uint8Array }
  | { kind: "unknown"; type: number };

export function parseYjsMessage(message: Uint8Array): ParsedYjsMessage {
  const decoder = decoding.createDecoder(message);
  const type = decoding.readVarUint(decoder);
  if (type === MSG_SYNC) {
    const syncType = decoding.readVarUint(decoder);
    if (syncType === SYNC_STEP1) {
      return { kind: "sync-step1", decoder };
    }
    if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
      return {
        kind: "sync-payload",
        syncType,
        update: decoding.readVarUint8Array(decoder),
      };
    }
    return { kind: "unknown", type: syncType };
  }
  if (type === MSG_AWARENESS) {
    return { kind: "awareness", update: decoding.readVarUint8Array(decoder) };
  }
  return { kind: "unknown", type };
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncStep2Reply(doc: Y.Doc, step1Decoder: decoding.Decoder): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.readSyncStep1(step1Decoder, encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessFrom(
  awareness: awarenessProtocol.Awareness,
  clients?: number[],
): Uint8Array {
  const ids = clients ?? [...awareness.getStates().keys()];
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessRelay(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeAwarenessNulls(clientIds: number[], clock = Date.now()): Uint8Array {
  const payload = encoding.createEncoder();
  encoding.writeVarUint(payload, clientIds.length);
  for (const clientId of clientIds) {
    encoding.writeVarUint(payload, clientId);
    encoding.writeVarUint(payload, clock);
    encoding.writeVarString(payload, "null");
  }
  return encodeAwarenessRelay(encoding.toUint8Array(payload));
}

export function readAwarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update);
  const length = decoding.readVarUint(decoder);
  const ids: number[] = [];
  for (let i = 0; i < length; i += 1) {
    ids.push(decoding.readVarUint(decoder));
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
  }
  return ids;
}

export function applyAwarenessUpdate(
  awareness: awarenessProtocol.Awareness,
  update: Uint8Array,
  origin: unknown,
): void {
  awarenessProtocol.applyAwarenessUpdate(awareness, update, origin);
}

export function toSendBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
