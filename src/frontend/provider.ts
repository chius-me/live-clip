import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { ConnectionRole } from "../shared/protocol";
import {
  applyAwarenessUpdate,
  encodeAwarenessFrom,
  encodeSyncStep1,
  encodeSyncStep2Reply,
  encodeSyncUpdate,
  parseYjsMessage,
  toSendBuffer,
} from "../shared/y-wire";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "saved";

export type LiveClipProviderOptions = {
  url: string;
  doc: Y.Doc;
  awareness: Awareness;
  editSecret: string | null;
  onStatus: (status: ConnectionStatus) => void;
  onRole: (role: ConnectionRole) => void;
  onOnline: (count: number) => void;
  onToast?: (message: string) => void;
};

const PERMANENT_CLOSE = new Set([4004, 4404]);

export class LiveClipProvider {
  readonly awareness: Awareness;
  private readonly url: string;
  private readonly doc: Y.Doc;
  private readonly editSecret: string | null;
  private readonly onStatus: (status: ConnectionStatus) => void;
  private readonly onRole: (role: ConnectionRole) => void;
  private readonly onOnline: (count: number) => void;
  private readonly onToast?: (message: string) => void;
  private ws: WebSocket | null = null;
  private destroyed = false;
  private shouldReconnect = true;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private synced = false;
  private readonly onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly onAwarenessChange: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;

  constructor(options: LiveClipProviderOptions) {
    this.url = options.url;
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.editSecret = options.editSecret;
    this.onStatus = options.onStatus;
    this.onRole = options.onRole;
    this.onOnline = options.onOnline;
    this.onToast = options.onToast;
    this.onDocUpdate = (update, origin) => {
      if (
        origin === "remote" ||
        origin === "storage" ||
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      this.ws.send(toSendBuffer(encodeSyncUpdate(update)));
    };
    this.onAwarenessChange = ({ added, updated, removed }, origin) => {
      if (origin === "remote" || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.ws.send(
        toSendBuffer(encodeAwarenessFrom(this.awareness, [...added, ...updated, ...removed])),
      );
    };
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessChange);
    this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    this.shouldReconnect = false;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessChange);
    this.awareness.setLocalState(null);
    this.ws?.close(1000, "client destroy");
    this.ws = null;
  }

  private connect(): void {
    if (this.destroyed) {
      return;
    }
    this.onStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", editSecret: this.editSecret }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
        return;
      }
      this.handleBinary(new Uint8Array(event.data as ArrayBuffer));
    };
    ws.onclose = (event) => {
      if (this.ws === ws) {
        this.ws = null;
      }
      this.synced = false;
      if (!this.shouldReconnect || this.destroyed || PERMANENT_CLOSE.has(event.code)) {
        return;
      }
      const delay = Math.min(10_000, 250 * 2 ** this.attempt);
      this.attempt += 1;
      this.onStatus("reconnecting");
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private handleControl(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return;
    }
    const message = parsed as {
      type: string;
      role?: ConnectionRole;
      online?: number;
      message?: string;
    };
    if (message.type === "auth-ok" && (message.role === "editor" || message.role === "reader")) {
      this.attempt = 0;
      this.onRole(message.role);
      if (typeof message.online === "number") {
        this.onOnline(message.online);
      }
      this.onStatus("connected");
      this.ws?.send(toSendBuffer(encodeSyncStep1(this.doc)));
      this.ws?.send(toSendBuffer(encodeAwarenessFrom(this.awareness)));
      return;
    }
    if (message.type === "presence" && typeof message.online === "number") {
      this.onOnline(message.online);
      return;
    }
    if (message.type === "saved") {
      this.onStatus("saved");
      return;
    }
    if (message.type === "error") {
      this.onToast?.(message.message ?? "同步出错");
    }
  }

  private handleBinary(message: Uint8Array): void {
    const parsed = parseYjsMessage(message);
    if (parsed.kind === "sync-step1") {
      this.ws?.send(toSendBuffer(encodeSyncStep2Reply(this.doc, parsed.decoder)));
      return;
    }
    if (parsed.kind === "sync-payload") {
      Y.applyUpdate(this.doc, parsed.update, "remote");
      if (!this.synced) {
        this.synced = true;
        this.onStatus("saved");
      }
      return;
    }
    if (parsed.kind === "awareness") {
      applyAwarenessUpdate(this.awareness, parsed.update, "remote");
    }
  }
}
