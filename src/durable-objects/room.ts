import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import { hashesEqual, sha256Hex } from "../shared/crypto";
import { isLanguageId } from "../shared/languages";
import {
  DEFAULT_LANGUAGE,
  Y_LANGUAGE_KEY,
  Y_META_KEY,
  Y_TEXT_KEY,
  type ConnectionRole,
} from "../shared/protocol";
import {
  encodeAwarenessNulls,
  encodeAwarenessRelay,
  encodeSyncStep1,
  encodeSyncStep2Reply,
  encodeSyncUpdate,
  parseYjsMessage,
  readAwarenessClientIds,
  toSendBuffer,
} from "../shared/y-wire";
import { readLimits, type RoomLimits } from "../worker/env";

type SocketRole = "pending" | ConnectionRole;

type SocketAttachment = {
  role: SocketRole;
  awarenessClientIds: number[];
  windowStart: number;
  windowCount: number;
};

type DocumentRow = {
  snapshot: ArrayBuffer | null;
  language: string;
  created_at: number;
  updated_at: number;
  edit_secret_hash: string | null;
};

type UpdateRow = {
  data: ArrayBuffer;
};

export type RoomDebugState = {
  text: string;
  language: string;
  updateCount: number;
  hasSnapshot: boolean;
  updatedAt: number;
  createdAt: number;
  storageEmpty: boolean;
};

function asUint8Array(value: ArrayBuffer | Uint8Array | null | undefined): Uint8Array | null {
  if (!value) {
    return null;
  }
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function defaultAttachment(): SocketAttachment {
  return {
    role: "pending",
    awarenessClientIds: [],
    windowStart: 0,
    windowCount: 0,
  };
}

export class Room extends DurableObject<Env> {
  private readonly doc = new Y.Doc();
  private readonly limits: RoomLimits;
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.limits = readLimits(env);
    void ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.restoreDocument();
      this.loaded = true;
    });
  }

  async init(editSecretHash: string): Promise<{ ok: true }> {
    this.ensureLoaded();
    const existing = this.readDocument();
    if (existing) {
      return { ok: true };
    }
    this.doc.getMap(Y_META_KEY).set(Y_LANGUAGE_KEY, DEFAULT_LANGUAGE);
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO document (id, snapshot, language, created_at, updated_at, edit_secret_hash)
       VALUES (1, ?, ?, ?, ?, ?)`,
      snapshot,
      DEFAULT_LANGUAGE,
      now,
      now,
      editSecretHash,
    );
    await this.scheduleRetention(now);
    return { ok: true };
  }

  async connectionCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  async getDebugState(): Promise<RoomDebugState> {
    this.ensureLoaded();
    const row = this.readDocument();
    if (!row) {
      return {
        text: "",
        language: DEFAULT_LANGUAGE,
        updateCount: 0,
        hasSnapshot: false,
        updatedAt: 0,
        createdAt: 0,
        storageEmpty: true,
      };
    }
    const updateCount = this.ctx.storage.sql
      .exec<{ c: number }>("SELECT COUNT(*) AS c FROM updates")
      .one().c;
    return {
      text: this.doc.getText(Y_TEXT_KEY).toString(),
      language: this.currentLanguage(),
      updateCount,
      hasSnapshot: row.snapshot != null,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      storageEmpty: false,
    };
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureLoaded();
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const row = this.readDocument();
    if (!row) {
      return new Response("Not found", { status: 404 });
    }
    if (this.ctx.getWebSockets().length >= this.limits.maxConnections) {
      return new Response("Too many connections", { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(defaultAttachment());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureLoaded();
    const attachment = this.readAttachment(ws);
    if (typeof message === "string") {
      await this.handleControl(ws, attachment, message);
      return;
    }
    if (attachment.role === "pending") {
      this.sendJson(ws, {
        type: "error",
        code: "auth_required",
        message: "Authenticate first",
      });
      return;
    }
    if (!this.consumeRateLimit(ws, attachment)) {
      this.sendJson(ws, { type: "error", code: "rate_limited", message: "Too many messages" });
      return;
    }
    const bytes = new Uint8Array(message);
    if (bytes.byteLength > this.limits.maxMessageBytes) {
      this.sendJson(ws, { type: "error", code: "message_too_large", message: "Message too large" });
      return;
    }
    await this.handleYjs(ws, attachment, bytes);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      this.cleanupSocket(ws);
    } catch {
      // Closing sockets should not fail the isolate.
    }
    try {
      // 1005/1006 are reserved; echoing them throws InvalidAccessError.
      if (code === 1000 || (code >= 3000 && code <= 4999)) {
        ws.close(code, reason.slice(0, 123));
      } else {
        ws.close(1000, "closed");
      }
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      this.cleanupSocket(ws);
    } catch {
      // ignore
    }
  }

  async alarm(): Promise<void> {
    this.ensureLoaded();
    const row = this.readDocument();
    if (!row) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    const retentionMs = this.limits.retentionDays * 24 * 60 * 60 * 1000;
    const expiresAt = row.updated_at + retentionMs;
    if (Date.now() >= expiresAt) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.loaded = false;
      return;
    }
    await this.ctx.storage.setAlarm(expiresAt);
  }

  private async handleControl(
    ws: WebSocket,
    attachment: SocketAttachment,
    raw: string,
  ): Promise<void> {
    if (raw.length > 8_192) {
      ws.close(4001, "Control message too large");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.sendJson(ws, { type: "error", code: "invalid_json", message: "Invalid message" });
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      this.sendJson(ws, { type: "error", code: "invalid_message", message: "Invalid message" });
      return;
    }
    const type = (parsed as { type: unknown }).type;
    if (type !== "auth") {
      this.sendJson(ws, {
        type: "error",
        code: "unexpected_message",
        message: "Authenticate first",
      });
      return;
    }
    const secret = (parsed as { editSecret?: unknown }).editSecret;
    const role = await this.authorize(typeof secret === "string" ? secret : null);
    attachment.role = role;
    this.writeAttachment(ws, attachment);
    this.sendJson(ws, {
      type: "auth-ok",
      role,
      language: this.currentLanguage(),
      online: this.ctx.getWebSockets().length,
    });
    this.sendBytes(ws, encodeSyncStep1(this.doc));
    this.broadcastPresence();
  }

  private async handleYjs(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: Uint8Array,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseYjsMessage(message);
    } catch {
      this.sendJson(ws, { type: "error", code: "invalid_yjs", message: "Invalid Yjs message" });
      return;
    }

    if (parsed.kind === "sync-step1") {
      this.sendBytes(ws, encodeSyncStep2Reply(this.doc, parsed.decoder));
      return;
    }

    if (parsed.kind === "awareness") {
      attachment.awarenessClientIds = readAwarenessClientIds(parsed.update);
      this.writeAttachment(ws, attachment);
      this.broadcastBytes(encodeAwarenessRelay(parsed.update), ws);
      return;
    }

    if (parsed.kind !== "sync-payload") {
      this.sendJson(ws, { type: "error", code: "unknown_message", message: "Unknown message" });
      return;
    }

    if (attachment.role !== "editor") {
      this.sendJson(ws, {
        type: "error",
        code: "forbidden",
        message: "Read-only connection cannot edit",
      });
      return;
    }

    if (parsed.update.byteLength === 0) {
      return;
    }

    if (!this.canAcceptUpdate(parsed.update)) {
      this.sendJson(ws, {
        type: "error",
        code: "document_too_large",
        message: "Document exceeds size limit",
      });
      return;
    }

    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO updates (data, created_at) VALUES (?, ?)",
        parsed.update,
        now,
      );
      this.ctx.storage.sql.exec(
        "UPDATE document SET updated_at = ?, language = ? WHERE id = 1",
        now,
        this.currentLanguage(),
      );
    });

    try {
      Y.applyUpdate(this.doc, parsed.update, ws);
    } catch {
      this.ctx.storage.sql.exec("DELETE FROM updates WHERE seq = (SELECT MAX(seq) FROM updates)");
      this.sendJson(ws, { type: "error", code: "invalid_yjs", message: "Invalid Yjs data" });
      return;
    }

    this.syncLanguageColumn();
    this.maybeCompact();
    await this.scheduleRetention(now);
    this.broadcastBytes(encodeSyncUpdate(parsed.update), ws);
    this.sendJson(ws, { type: "saved" });
  }

  private canAcceptUpdate(update: Uint8Array): boolean {
    const current = Y.encodeStateAsUpdate(this.doc).byteLength;
    if (current > this.limits.maxDocumentBytes) {
      return false;
    }
    if (current + update.byteLength <= this.limits.maxDocumentBytes) {
      return true;
    }
    const tmp = new Y.Doc();
    try {
      Y.applyUpdate(tmp, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(tmp, update);
      return Y.encodeStateAsUpdate(tmp).byteLength <= this.limits.maxDocumentBytes;
    } catch {
      return false;
    } finally {
      tmp.destroy();
    }
  }

  private maybeCompact(): void {
    const count = Number(
      this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM updates").one().c,
    );
    let bytes = 0;
    try {
      bytes = Number(
        this.ctx.storage.sql
          .exec<{ b: number | null }>("SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM updates")
          .one().b ?? 0,
      );
    } catch {
      bytes = 0;
    }
    if (count < this.limits.compactUpdateCount && bytes < this.limits.compactUpdateBytes) {
      return;
    }
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE document SET snapshot = ?, language = ?, updated_at = ? WHERE id = 1",
        snapshot,
        this.currentLanguage(),
        now,
      );
      this.ctx.storage.sql.exec("DELETE FROM updates");
    });
  }

  private async authorize(secret: string | null): Promise<ConnectionRole> {
    const row = this.readDocument();
    const stored = row?.edit_secret_hash;
    if (!secret || !stored) {
      return "reader";
    }
    const incoming = await sha256Hex(secret);
    return hashesEqual(incoming, stored) ? "editor" : "reader";
  }

  private currentLanguage(): string {
    const value = this.doc.getMap(Y_META_KEY).get(Y_LANGUAGE_KEY);
    return typeof value === "string" && isLanguageId(value) ? value : DEFAULT_LANGUAGE;
  }

  private syncLanguageColumn(): void {
    this.ctx.storage.sql.exec(
      "UPDATE document SET language = ? WHERE id = 1",
      this.currentLanguage(),
    );
  }

  private restoreDocument(): void {
    const row = this.readDocument();
    if (!row) {
      return;
    }
    const snapshot = asUint8Array(row.snapshot);
    if (snapshot && snapshot.byteLength > 0) {
      Y.applyUpdate(this.doc, snapshot, "storage");
    }
    const updates = this.ctx.storage.sql
      .exec<UpdateRow>("SELECT data FROM updates ORDER BY seq ASC")
      .toArray();
    for (const update of updates) {
      const data = asUint8Array(update.data);
      if (data) {
        try {
          Y.applyUpdate(this.doc, data, "storage");
        } catch {
          console.error(JSON.stringify({ msg: "skipped invalid stored update" }));
        }
      }
    }
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS document (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot BLOB,
        language TEXT NOT NULL DEFAULT 'plaintext',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        edit_secret_hash TEXT
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  private readDocument(): DocumentRow | null {
    const rows = this.ctx.storage.sql
      .exec<DocumentRow>(
        "SELECT snapshot, language, created_at, updated_at, edit_secret_hash FROM document WHERE id = 1",
      )
      .toArray();
    return rows[0] ?? null;
  }

  private async scheduleRetention(updatedAt: number): Promise<void> {
    const expiresAt = updatedAt + this.limits.retentionDays * 24 * 60 * 60 * 1000;
    await this.ctx.storage.setAlarm(expiresAt);
  }

  private cleanupSocket(ws: WebSocket): void {
    const attachment = this.readAttachment(ws);
    if (attachment.awarenessClientIds.length > 0) {
      this.broadcastBytes(encodeAwarenessNulls(attachment.awarenessClientIds), ws);
    }
    this.broadcastPresence();
  }

  private broadcastPresence(): void {
    this.broadcastJson({ type: "presence", online: this.ctx.getWebSockets().length });
  }

  private consumeRateLimit(ws: WebSocket, attachment: SocketAttachment): boolean {
    const now = Date.now();
    if (now - attachment.windowStart >= this.limits.rateLimitWindowMs) {
      attachment.windowStart = now;
      attachment.windowCount = 1;
      this.writeAttachment(ws, attachment);
      return true;
    }
    attachment.windowCount += 1;
    this.writeAttachment(ws, attachment);
    return attachment.windowCount <= this.limits.rateLimitMessages;
  }

  private readAttachment(ws: WebSocket): SocketAttachment {
    const raw = ws.deserializeAttachment() as SocketAttachment | null;
    if (!raw || typeof raw !== "object") {
      return defaultAttachment();
    }
    return {
      role:
        raw.role === "editor" || raw.role === "reader" || raw.role === "pending"
          ? raw.role
          : "pending",
      awarenessClientIds: Array.isArray(raw.awarenessClientIds) ? raw.awarenessClientIds : [],
      windowStart: typeof raw.windowStart === "number" ? raw.windowStart : 0,
      windowCount: typeof raw.windowCount === "number" ? raw.windowCount : 0,
    };
  }

  private writeAttachment(ws: WebSocket, attachment: SocketAttachment): void {
    ws.serializeAttachment(attachment);
  }

  private sendJson(ws: WebSocket, value: unknown): void {
    try {
      ws.send(JSON.stringify(value));
    } catch {
      // Socket already closing.
    }
  }

  private sendBytes(ws: WebSocket, bytes: Uint8Array): void {
    try {
      ws.send(toSendBuffer(bytes));
    } catch {
      // Socket already closing.
    }
  }

  private broadcastBytes(bytes: Uint8Array, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) {
        continue;
      }
      this.sendBytes(socket, bytes);
    }
  }

  private broadcastJson(value: unknown): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.sendJson(socket, value);
    }
  }

  private ensureLoaded(): void {
    this.migrate();
    if (!this.loaded) {
      this.restoreDocument();
      this.loaded = true;
    }
  }
}
