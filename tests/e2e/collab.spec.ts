import { expect, type Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

async function createRoom(page: Page) {
  const response = await page.request.post("/api/rooms");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { roomId: string; editSecret: string };
}

async function waitReady(page: Page) {
  await page.waitForSelector(".monaco-editor");
  await expect(page.getByTestId("status")).toHaveText("已保存", { timeout: 30_000 });
}

async function readYjs(page: Page) {
  return page.evaluate(() => window.__LIVECLIP_TEXT?.() ?? "");
}

async function readMonaco(page: Page) {
  return page.evaluate(() => window.__LIVECLIP_MONACO?.() ?? "");
}

async function editorSnapshot(page: Page) {
  return page.evaluate(() => ({
    yjs: window.__LIVECLIP_TEXT?.() ?? "",
    monaco: window.__LIVECLIP_MONACO?.() ?? "",
  }));
}

async function focusEditor(page: Page) {
  await page.locator(".monaco-editor .view-lines").click({
    force: true,
    position: { x: 24, y: 12 },
  });
}

async function typeInEditor(page: Page, text: string) {
  await focusEditor(page);
  await page.keyboard.type(text, { delay: 20 });
}

async function typeAtOffset(page: Page, index: number, text: string) {
  await page.evaluate((offset) => {
    window.__LIVECLIP_FOCUS_OFFSET?.(offset);
  }, index);
  await page.keyboard.type(text, { delay: 20 });
}

async function executeMonacoEdit(page: Page, index: number, text: string) {
  await page.evaluate(
    ([offset, value]) => {
      window.__LIVECLIP_EXECUTE_EDIT?.(offset, value);
    },
    [index, text] as const,
  );
}

async function waitEditorsConverged(
  pageA: Page,
  pageB: Page,
  contains: string[],
  timeout = 20_000,
) {
  try {
    await expect
      .poll(
        async () => {
          const a = await editorSnapshot(pageA);
          const b = await editorSnapshot(pageB);
          const ok =
            a.monaco === a.yjs &&
            b.monaco === b.yjs &&
            a.monaco === b.monaco &&
            contains.every((item) => a.monaco.includes(item));
          return ok ? a.monaco : "";
        },
        { timeout },
      )
      .not.toEqual("");
  } catch (error) {
    const a = await editorSnapshot(pageA);
    const b = await editorSnapshot(pageB);
    throw new Error(
      `editors did not converge (${JSON.stringify({ a, b, contains })}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function expectMonacoMatchesYjs(page: Page) {
  await expect
    .poll(
      async () => {
        const snap = await editorSnapshot(page);
        return snap.monaco === snap.yjs ? snap.yjs : "";
      },
      { timeout: 20_000 },
    )
    .not.toEqual("");
  const snap = await editorSnapshot(page);
  expect(snap.monaco).toBe(snap.yjs);
}

test("two browsers collaborate, reconnect, and honor read-only links", async ({
  browser,
}, testInfo) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextRead = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageRead = await contextRead.newPage();

  const created = await createRoom(pageA);
  const editUrl = `/p/${created.roomId}#${created.editSecret}`;
  const readUrl = `/p/${created.roomId}`;

  await pageA.goto(editUrl);
  await pageB.goto(editUrl);
  await waitReady(pageA);
  await waitReady(pageB);

  await expect(pageA.getByTestId("role")).toHaveText("可编辑");
  await expect(pageB.getByTestId("role")).toHaveText("可编辑");
  await expect(pageA.getByTestId("online-count")).toHaveText(/在线 [2-9]/);

  await typeInEditor(pageA, "aaaa");
  await expect.poll(async () => readYjs(pageB), { timeout: 15_000 }).toContain("aaaa");
  await expectMonacoMatchesYjs(pageA);
  await expectMonacoMatchesYjs(pageB);

  await Promise.all([executeMonacoEdit(pageA, 0, "1111"), executeMonacoEdit(pageB, 4, "2222")]);
  await waitEditorsConverged(pageA, pageB, ["1111", "2222", "aaaa"]);

  await Promise.all([typeAtOffset(pageA, 0, "XX"), typeAtOffset(pageB, 4, "YY")]);
  await waitEditorsConverged(pageA, pageB, ["XX", "YY", "1111", "2222"]);

  const beforeReload = await readYjs(pageA);
  expect(await readMonaco(pageA)).toBe(beforeReload);
  await pageA.reload();
  await waitReady(pageA);
  await expect.poll(async () => readYjs(pageA)).toBe(beforeReload);
  await expectMonacoMatchesYjs(pageA);

  await contextB.setOffline(true);
  await typeInEditor(pageB, "offline");
  await contextB.setOffline(false);
  await waitReady(pageB);
  await waitEditorsConverged(pageA, pageB, ["offline"]);

  await pageRead.goto(readUrl);
  await waitReady(pageRead);
  await expect(pageRead.getByTestId("role")).toHaveText("只读");
  await expect(pageRead.getByTestId("language")).toBeDisabled();
  const readBefore = await readYjs(pageRead);
  await focusEditor(pageRead);
  await pageRead.keyboard.type("should-not-edit");
  await expect.poll(async () => readYjs(pageRead)).toBe(readBefore);
  await expect.poll(async () => readMonaco(pageRead)).toBe(readBefore);
  await expect.poll(async () => readYjs(pageA)).toBe(await readYjs(pageB));
  await expectMonacoMatchesYjs(pageA);
  await expectMonacoMatchesYjs(pageB);

  await typeInEditor(pageA, "Z");
  await expect.poll(async () => readYjs(pageRead)).toContain("Z");
  await expectMonacoMatchesYjs(pageRead);
  await expectMonacoMatchesYjs(pageA);

  const screenshotPath = testInfo.outputPath("editor.png");
  await pageA.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  const scratch = process.env.SCRATCH_DIR;
  if (scratch) {
    mkdirSync(scratch, { recursive: true });
    await pageA.screenshot({
      path: path.join(scratch, "editor-sync.png"),
      fullPage: true,
    });
  }

  await contextA.close();
  await contextB.close();
  await contextRead.close();
});
