import { expect, type Page, test } from "@playwright/test";

async function createRoom(page: Page) {
  const response = await page.request.post("/api/rooms");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { roomId: string; editSecret: string };
}

async function waitReady(page: Page) {
  await page.waitForSelector(".monaco-editor");
  await expect(page.getByTestId("status")).toHaveText(/已连接|已保存/, { timeout: 30_000 });
}

async function readText(page: Page) {
  return page.evaluate(() => window.__LIVECLIP_TEXT?.() ?? "");
}

async function insertAt(page: Page, index: number, value: string) {
  await page.evaluate(
    ([at, text]) => {
      window.__LIVECLIP_INSERT?.(at, text);
    },
    [index, value] as const,
  );
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
  await expect.poll(async () => readText(pageB), { timeout: 15_000 }).toContain("aaaa");

  await Promise.all([insertAt(pageA, 0, "1111"), insertAt(pageB, 4, "2222")]);

  await expect
    .poll(
      async () => {
        const a = await readText(pageA);
        const b = await readText(pageB);
        return a === b && a.includes("1111") && a.includes("2222") && a.includes("aaaa") ? a : "";
      },
      { timeout: 20_000 },
    )
    .not.toEqual("");

  const beforeReload = await readText(pageA);
  await pageA.reload();
  await waitReady(pageA);
  await expect.poll(async () => readText(pageA)).toBe(beforeReload);

  await contextB.setOffline(true);
  await typeInEditor(pageB, "offline");
  await contextB.setOffline(false);
  await waitReady(pageB);
  await expect
    .poll(
      async () => {
        const a = await readText(pageA);
        const b = await readText(pageB);
        return a === b && a.includes("offline") ? a : "";
      },
      { timeout: 20_000 },
    )
    .not.toEqual("");

  await pageRead.goto(readUrl);
  await waitReady(pageRead);
  await expect(pageRead.getByTestId("role")).toHaveText("只读");
  await expect(pageRead.getByTestId("language")).toBeDisabled();
  const readBefore = await readText(pageRead);
  await focusEditor(pageRead);
  await pageRead.keyboard.type("should-not-edit");
  await expect.poll(async () => readText(pageRead)).toBe(readBefore);
  await expect.poll(async () => readText(pageA)).toBe(await readText(pageB));

  await typeInEditor(pageA, "Z");
  await expect.poll(async () => readText(pageRead)).toContain("Z");

  await pageA.screenshot({
    path: testInfo.outputPath("editor.png"),
    fullPage: true,
  });

  await contextA.close();
  await contextB.close();
  await contextRead.close();
});
