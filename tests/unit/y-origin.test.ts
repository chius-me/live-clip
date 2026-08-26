import { describe, expect, it } from "vitest";
import { Y_TEXT_KEY } from "../../src/shared/protocol";
import {
  applyRemoteYjsUpdate,
  shouldSendYjsUpdate,
  YJS_ORIGIN_REMOTE,
  YJS_ORIGIN_STORAGE,
} from "../../src/shared/y-origin";
import * as Y from "yjs";

describe("shipped Yjs update handler", () => {
  it("does not mark remote or storage origins as outbound", () => {
    expect(shouldSendYjsUpdate(YJS_ORIGIN_REMOTE, true)).toBe(false);
    expect(shouldSendYjsUpdate(YJS_ORIGIN_STORAGE, true)).toBe(false);
    expect(shouldSendYjsUpdate("local", true)).toBe(true);
    expect(shouldSendYjsUpdate(null, true)).toBe(true);
    expect(shouldSendYjsUpdate("local", false)).toBe(false);
  });

  it("applying a remote update does not echo and applying it twice does not double text", () => {
    const doc = new Y.Doc();
    const outbound: Uint8Array[] = [];
    doc.on("update", (update, origin) => {
      if (shouldSendYjsUpdate(origin, true)) {
        outbound.push(update);
      }
    });

    const source = new Y.Doc();
    source.getText(Y_TEXT_KEY).insert(0, "hello");
    const update = Y.encodeStateAsUpdate(source);

    applyRemoteYjsUpdate(doc, update);
    applyRemoteYjsUpdate(doc, update);

    expect(doc.getText(Y_TEXT_KEY).toString()).toBe("hello");
    expect(outbound).toHaveLength(0);

    doc.getText(Y_TEXT_KEY).insert(5, "!");
    expect(doc.getText(Y_TEXT_KEY).toString()).toBe("hello!");
    expect(outbound.length).toBeGreaterThan(0);
  });
});
