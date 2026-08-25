import { SELF } from "cloudflare:test";
import * as Y from "yjs";
import { Y_TEXT_KEY } from "../../src/shared/protocol";
import {
  encodeSyncStep1,
  encodeSyncStep2Reply,
  encodeSyncUpdate,
  parseYjsMessage,
  toSendBuffer,
} from "../../src/shared/y-wire";

export type CreatedRoom = {
  roomId: string;
  editSecret: string;
  readPath: string;
  editPath: string;
};

export async function createRoom(): Promise<CreatedRoom> {
  const response = await SELF.fetch("https://example.com/api/rooms", { method: "POST" });
  if (!response.ok) {
    throw new Error(`createRoom failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as CreatedRoom;
}

export async function openSocket(
  roomId: string,
  origin = "https://example.com",
): Promise<Response> {
  return SELF.fetch(`https://example.com/api/rooms/${roomId}/ws`, {
    headers: {
      Upgrade: "websocket",
      Origin: origin,
    },
  });
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("waitFor timed out");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class YjsTestClient {
  readonly doc = new Y.Doc();
  readonly ws: WebSocket;
  readonly response: Response;
  role: string | null = null;
  online = 0;
  saved = 0;
  errors: string[] = [];
  private readonly ready: Promise<void>;
  private resolveReady: () => void = () => undefined;

  constructor(ws: WebSocket, secret: string | null, response: Response) {
    this.ws = ws;
    this.response = response;
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.doc.on("update", (update, origin) => {
      if (origin === "remote" || origin === "storage") {
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(toSendBuffer(encodeSyncUpdate(update)));
      }
    });
    this.ws.addEventListener("message", (event) => {
      try {
        this.onMessage(event.data as string | ArrayBuffer | Uint8Array);
      } catch (error) {
        this.errors.push(error instanceof Error ? error.message : "message error");
      }
    });
    this.ws.send(JSON.stringify({ type: "auth", editSecret: secret }));
  }

  get text(): string {
    return this.doc.getText(Y_TEXT_KEY).toString();
  }

  async waitReady(timeoutMs = 8_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("auth-ok not received")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  insert(index: number, value: string): void {
    this.doc.getText(Y_TEXT_KEY).insert(index, value);
  }

  private onMessage(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data === "string") {
      const message = JSON.parse(data) as {
        type: string;
        role?: string;
        online?: number;
        message?: string;
      };
      if (message.type === "auth-ok") {
        this.role = message.role ?? null;
        this.online = message.online ?? this.online;
        this.ws.send(toSendBuffer(encodeSyncStep1(this.doc)));
        this.resolveReady();
      } else if (message.type === "presence" && typeof message.online === "number") {
        this.online = message.online;
      } else if (message.type === "saved") {
        this.saved += 1;
      } else if (message.type === "error") {
        this.errors.push(message.message ?? message.type);
      }
      return;
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const parsed = parseYjsMessage(bytes);
    if (parsed.kind === "sync-step1") {
      this.ws.send(toSendBuffer(encodeSyncStep2Reply(this.doc, parsed.decoder)));
      return;
    }
    if (parsed.kind === "sync-payload") {
      Y.applyUpdate(this.doc, parsed.update, "remote");
    }
  }
}

export async function connectClient(roomId: string, secret: string | null): Promise<YjsTestClient> {
  const response = await openSocket(roomId);
  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`websocket upgrade failed: ${response.status}`);
  }
  response.webSocket.accept();
  response.webSocket.binaryType = "arraybuffer";
  await sleep(0);
  const client = new YjsTestClient(response.webSocket, secret, response);
  await client.waitReady();
  return client;
}
