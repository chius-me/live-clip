import {
  SELF,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Room } from "../../src/durable-objects/room";
import { isValidRoomId } from "../../src/shared/ids";
import { DEFAULT_LIMITS } from "../../src/shared/limits";
import { Y_TEXT_KEY } from "../../src/shared/protocol";
import { encodeSyncUpdate, toSendBuffer } from "../../src/shared/y-wire";
import * as Y from "yjs";
import { connectClient, createRoom, openSocket, sleep, waitFor } from "./helpers";

describe("HTTP routes", () => {
  it("serves health twice with a successful payload", async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await SELF.fetch("https://example.com/health");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; service: string; now: number };
      expect(body.ok).toBe(true);
      expect(body.service).toBe("liveclip");
      expect(typeof body.now).toBe("number");
    }
  });

  it("creates a room via POST without putting the secret in a query string", async () => {
    const response = await SELF.fetch("https://example.com/api/rooms", { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      roomId: string;
      editSecret: string;
      readPath: string;
      editPath: string;
    };
    expect(isValidRoomId(body.roomId)).toBe(true);
    expect(body.editSecret).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(body.readPath).toBe(`/p/${body.roomId}`);
    expect(body.editPath).toBe(`/p/${body.roomId}#${body.editSecret}`);
    expect(body.editPath.includes("?")).toBe(false);
  });

  it("creates a room on GET / and redirects with a fragment secret", async () => {
    const response = await SELF.fetch("https://example.com/", { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = response.headers.get("Location") ?? "";
    expect(location).toMatch(/^\/p\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{24}$/);
    expect(location.includes("?")).toBe(false);
  });

  it("rejects invalid room ids and invalid websocket origins", async () => {
    const badId = await SELF.fetch("https://example.com/api/rooms/not-valid/ws", {
      headers: { Upgrade: "websocket", Origin: "https://example.com" },
    });
    expect(badId.status).toBe(400);

    const { roomId } = await createRoom();
    const badOrigin = await openSocket(roomId, "https://evil.example");
    expect(badOrigin.status).toBe(403);
  });
});

describe("Room Durable Object", () => {
  it("initializes a new room", async () => {
    const created = await createRoom();
    const stub = env.ROOMS.getByName(created.roomId);
    const state = await stub.getDebugState();
    expect(state.storageEmpty).toBe(false);
    expect(state.text).toBe("");
    expect(state.language).toBe("plaintext");
    expect(state.updateCount).toBe(0);
  });

  it("writes content and reads it back after reload", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    expect(editor.role).toBe("editor");
    editor.insert(0, "persisted clipboard");

    const stub = env.ROOMS.getByName(created.roomId);
    await waitFor(async () => (await stub.getDebugState()).text === "persisted clipboard");
    expect((await stub.getDebugState()).text).toBe("persisted clipboard");

    const reader = await connectClient(created.roomId, null);
    await waitFor(() => reader.text === "persisted clipboard");
    expect(reader.text).toBe("persisted clipboard");
  });

  it("compacts updates into a snapshot after the threshold", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    const stub = env.ROOMS.getByName(created.roomId);

    for (let i = 0; i < DEFAULT_LIMITS.COMPACT_UPDATE_COUNT; i += 1) {
      editor.insert(editor.text.length, "x");
      await sleep(40);
    }

    let last = await stub.getDebugState();
    try {
      await waitFor(async () => {
        last = await stub.getDebugState();
        return (
          last.text.length >= DEFAULT_LIMITS.COMPACT_UPDATE_COUNT &&
          last.hasSnapshot &&
          last.updateCount < DEFAULT_LIMITS.COMPACT_UPDATE_COUNT
        );
      }, 20_000);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "compact wait failed"}: ${JSON.stringify(last)}`,
      );
    }

    const compacted = await stub.getDebugState();
    expect(compacted.hasSnapshot).toBe(true);
    expect(compacted.updateCount).toBeLessThan(DEFAULT_LIMITS.COMPACT_UPDATE_COUNT);
    expect(compacted.text.length).toBe(DEFAULT_LIMITS.COMPACT_UPDATE_COUNT);
  });

  it("restores the document after Durable Object eviction", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    editor.insert(0, "survive eviction");
    const stub = env.ROOMS.getByName(created.roomId);
    await waitFor(async () => (await stub.getDebugState()).text === "survive eviction");

    await evictDurableObject(stub);

    const restored = await stub.getDebugState();
    expect(restored.text).toBe("survive eviction");
    expect(restored.storageEmpty).toBe(false);
  });

  it("rejects unauthorized document updates", async () => {
    const created = await createRoom();
    const reader = await connectClient(created.roomId, null);
    expect(reader.role).toBe("reader");
    reader.insert(0, "should not land");
    const stub = env.ROOMS.getByName(created.roomId);
    await waitFor(() => reader.errors.length > 0);
    expect((await stub.getDebugState()).text).toBe("");
  });

  it("lets a read-only client receive sync after an authorized edit", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    const reader = await connectClient(created.roomId, null);
    expect(reader.role).toBe("reader");

    editor.insert(0, "hello from editor");
    await waitFor(() => reader.text === "hello from editor");
    expect(reader.text).toBe("hello from editor");

    reader.insert(reader.text.length, " nope");
    await waitFor(() => reader.errors.length > 0);
    expect(editor.text).toBe("hello from editor");
    const stub = env.ROOMS.getByName(created.roomId);
    expect((await stub.getDebugState()).text).toBe("hello from editor");
  });

  it("rejects oversized messages", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    const huge = new Uint8Array(DEFAULT_LIMITS.MAX_MESSAGE_BYTES + 8);
    huge[0] = 0;
    editor.ws.send(huge.buffer);
    await waitFor(() => editor.errors.some((item) => item.toLowerCase().includes("large")));
    const stub = env.ROOMS.getByName(created.roomId);
    expect((await stub.getDebugState()).text).toBe("");
  });

  it("rejects connections past the room limit", async () => {
    const created = await createRoom();
    const stub = env.ROOMS.getByName(created.roomId);
    const held: Response[] = [];
    for (let i = 0; i < DEFAULT_LIMITS.MAX_CONNECTIONS; i += 1) {
      const response = await openSocket(created.roomId);
      expect(response.status).toBe(101);
      expect(response.webSocket).toBeTruthy();
      response.webSocket!.accept();
      held.push(response);
    }
    await waitFor(async () => (await stub.connectionCount()) >= DEFAULT_LIMITS.MAX_CONNECTIONS);
    expect(await stub.connectionCount()).toBe(DEFAULT_LIMITS.MAX_CONNECTIONS);
    const overflow = await openSocket(created.roomId);
    expect(overflow.status).toBe(503);
    expect(overflow.webSocket).toBeFalsy();
    for (const response of held) {
      response.webSocket?.close(1000, "done");
    }
  });

  it("does not delete an active document when an old alarm fires", async () => {
    const created = await createRoom();
    const editor = await connectClient(created.roomId, created.editSecret);
    editor.insert(0, "still active");
    const stub = env.ROOMS.getByName(created.roomId);
    await waitFor(async () => (await stub.getDebugState()).text === "still active");

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const state = await stub.getDebugState();
    expect(state.storageEmpty).toBe(false);
    expect(state.text).toBe("still active");
  });

  it("deletes storage when the document is past retention", async () => {
    const created = await createRoom();
    const stub = env.ROOMS.getByName(created.roomId);
    await stub.getDebugState();

    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(Room);
      const expired = Date.now() - 40 * 24 * 60 * 60 * 1000;
      state.storage.sql.exec("UPDATE document SET updated_at = ? WHERE id = 1", expired);
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const state = await stub.getDebugState();
    expect(state.storageEmpty).toBe(true);
    expect(state.text).toBe("");
  });

  it("converges two Y.Doc clients that insert concurrently", async () => {
    const created = await createRoom();
    const a = await connectClient(created.roomId, created.editSecret);
    const b = await connectClient(created.roomId, created.editSecret);

    a.insert(0, "ALPHA");
    b.insert(0, "BETA");

    const stub = env.ROOMS.getByName(created.roomId);
    await waitFor(async () => {
      const text = (await stub.getDebugState()).text;
      return text.includes("ALPHA") && text.includes("BETA");
    });
    await waitFor(() => a.text === b.text && a.text.includes("ALPHA") && a.text.includes("BETA"));
    expect(a.text).toBe(b.text);
    expect(a.text).toContain("ALPHA");
    expect(a.text).toContain("BETA");

    expect((await stub.getDebugState()).text).toBe(a.text);
  });

  it("converges concurrent inserts at different indexes and a fresh reconnect socket", async () => {
    const created = await createRoom();
    const a = await connectClient(created.roomId, created.editSecret);
    const b = await connectClient(created.roomId, created.editSecret);

    a.insert(0, "aaaa");
    await waitFor(() => a.text === "aaaa" && b.text === "aaaa");

    a.insert(0, "1111");
    b.insert(4, "2222");

    await waitFor(
      () =>
        a.text === b.text &&
        a.text.includes("1111") &&
        a.text.includes("2222") &&
        a.text.includes("aaaa"),
    );
    expect(a.text).toBe(b.text);
    expect(a.text).toContain("1111");
    expect(a.text).toContain("2222");
    expect(a.text).toContain("aaaa");

    a.ws.close(1000, "reconnect test");
    const c = await connectClient(created.roomId, created.editSecret);
    expect(c.doc).not.toBe(a.doc);
    await waitFor(() => c.text === b.text);
    expect(c.text).toBe(b.text);
    expect(c.synced).toBe(true);
    expect((await env.ROOMS.getByName(created.roomId).getDebugState()).text).toBe(b.text);
  });

  it("replays local edits made while disconnected on the same Y.Doc", async () => {
    const created = await createRoom();
    const a = await connectClient(created.roomId, created.editSecret);
    const b = await connectClient(created.roomId, created.editSecret);
    a.insert(0, "hello");
    await waitFor(() => a.text === "hello" && b.text === "hello");

    a.ws.close(1000, "offline");
    await sleep(50);
    a.insert(5, "!");
    expect(a.text).toBe("hello!");

    const a2 = await connectClient(created.roomId, created.editSecret, a.doc);
    await waitFor(() => b.text === "hello!" && a2.text === "hello!");
    expect(b.text).toBe("hello!");
    expect(a2.text).toBe("hello!");
    expect((await env.ROOMS.getByName(created.roomId).getDebugState()).text).toBe("hello!");
  });

  it("ignores a raw Yjs update that never passed through server persist when unauthorized", async () => {
    const created = await createRoom();
    const rogueDoc = new Y.Doc();
    rogueDoc.getText(Y_TEXT_KEY).insert(0, "rogue");
    const update = Y.encodeStateAsUpdate(rogueDoc);
    const reader = await connectClient(created.roomId, null);
    reader.ws.send(toSendBuffer(encodeSyncUpdate(update)));
    await waitFor(() => reader.errors.length > 0);
    const stub = env.ROOMS.getByName(created.roomId);
    expect((await stub.getDebugState()).text).toBe("");
  });
});
