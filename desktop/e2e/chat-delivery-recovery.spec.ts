import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { localBook } from "./localBook";

test("re-reviews stale pending Memory context with fresh permission and a durable question", async ({ page }, testInfo) => {
  let invalidate = true;
  let maraId = "";
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const book = await localBook(page, { beforeSidecar: async (root, request) => {
    requests.push({ method: request.method, params: request.params });
    if (request.method === "chat.send" && invalidate) {
      invalidate = false;
      const changed = await book.core(root, ["codex", "update", "--id", maraId, "--description", "CURRENT-PUBLIC-FACT: Mara now returns the winter key.", "--json"]);
      expect(changed.status, changed.stderr).toBe(0);
    }
  } });
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByRole("button", { name: /^Story Memory \(/ }).click();
    await page.getByPlaceholder("Entity name...").fill("Mara");
    await page.getByRole("button", { name: "Add Memory Entry", exact: true }).click();
    await page.getByRole("button", { name: "◆ Mara", exact: true }).click();
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("OLD-PUBLIC-FACT: Mara keeps the winter key.");
    await page.getByRole("textbox", { name: "Private author notes", exact: true }).fill("PRIVATE-RECOVERY-NOTE: an author reflection.");
    await page.getByRole("combobox", { name: "Assistant access", exact: true }).selectOption("ask");
    await page.getByRole("button", { name: "Save Memory", exact: true }).click();
    await expect(page.getByText("Story Memory entry saved.", { exact: true })).toBeVisible();
    maraId = (await json(["codex", "list"]))[0].id;
    await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("character");
    await page.getByRole("combobox", { name: "Assistant character scope" }).selectOption(maraId);
    const composer = page.getByPlaceholder("Type a message... (@ to mention)");
    const question = "How can Mara's choice show responsibility?";
    await composer.fill(question);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const review = page.getByRole("region", { name: "Review AI context" });
    await review.getByRole("checkbox", { name: "Allow Mara for this turn" }).check();
    await expect(review.getByRole("button", { name: "Send reviewed context" })).toBeEnabled();
    await review.getByRole("button", { name: "Send reviewed context" }).click();
    await expect(page.getByText(/Context changed since the preview/)).toBeVisible();
    const [thread] = await json(["chat", "thread", "list"]);
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toHaveLength(0);
    expect(await json(["generation", "list"])).toHaveLength(0);
    const original = requests.find(request => request.method === "chat.send")!.params;
    await composer.fill("A separate unfinished question");
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("storyline");
    await page.screenshot({ path: testInfo.outputPath("stale-question-saved.png") });
    await page.getByRole("button", { name: "Review current context" }).click();
    await expect(review).toBeVisible();
    await expect(review.getByRole("textbox", { name: "Saved question" })).toHaveValue(question);
    await expect(review.getByRole("checkbox", { name: "Allow Mara for this turn" })).not.toBeChecked();
    await expect(review.getByRole("button", { name: "Send reviewed context" })).toBeDisabled();
    expect(requests.filter(request => request.method === "chat.send")).toHaveLength(1);
    expect(requests.find(request => request.method === "chat.delivery.reconcile")!.params.request_id).toBe(original.delivery_id);
    await review.getByRole("button", { name: "Back to message" }).click();
    await expect(composer).toHaveValue("A separate unfinished question");
    await expect(page.getByRole("combobox", { name: "Assistant conversation scope" })).toHaveValue("storyline");
    await page.getByRole("button", { name: "Review current context" }).click();
    await review.getByRole("textbox", { name: "Saved question" }).fill("How can Mara returning the key show responsibility?");
    await review.getByRole("checkbox", { name: "Allow Mara for this turn" }).check();
    await expect(review.getByRole("button", { name: "Send reviewed context" })).toBeEnabled();
    await review.getByText("Inspect exact initial prompts and history").click();
    await expect(review.locator("pre")).toContainText("CURRENT-PUBLIC-FACT");
    await expect(review.locator("pre")).not.toContainText("PRIVATE-RECOVERY-NOTE");
    await review.locator("pre").evaluate(element => {
      const node = element.firstChild;
      const offset = element.textContent?.indexOf("CURRENT-PUBLIC-FACT") ?? -1;
      if (!node || offset < 0) throw new Error("Current fact missing from exact-context evidence.");
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + "CURRENT-PUBLIC-FACT".length);
      element.scrollTop += range.getBoundingClientRect().top - element.getBoundingClientRect().top - 30;
    });
    await page.screenshot({ path: testInfo.outputPath("fresh-context-reviewed.png") });
    await review.getByRole("button", { name: "Back to message" }).click();
    await page.reload();
    // The sidebar's open preference survives a restart. Reveal it only when
    // needed, then select the saved thread regardless of the current label.
    await expect(page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true })).toBeVisible();
    const threadPicker = page.getByTitle("Switch thread", { exact: true });
    if (!await threadPicker.isVisible()) await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await threadPicker.click();
    await page.locator(".chat-dropdown__item").filter({ hasText: "New Chat" }).click();
    await page.getByRole("button", { name: "Review current context" }).click();
    await expect(review.getByRole("textbox", { name: "Saved question" })).toHaveValue("How can Mara returning the key show responsibility?");
    await expect(review.getByRole("checkbox", { name: "Allow Mara for this turn" })).not.toBeChecked();
    await expect(review.getByRole("button", { name: "Send reviewed context" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("restart-requires-permission.png") });
    await review.getByRole("checkbox", { name: "Allow Mara for this turn" }).check();
    await review.getByRole("button", { name: "Send reviewed context" }).click();
    await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
    const sent = requests.filter(request => request.method === "chat.send");
    expect(sent).toHaveLength(2);
    expect(sent[1].params.delivery_id).not.toBe(original.delivery_id);
    expect(sent[1].params.turn_id).not.toBe(original.turn_id);
    expect(sent[1].params.expected_context_fingerprint).not.toBe(original.expected_context_fingerprint);
    expect(sent[1].params.context_overrides).toEqual({ scope: "character" });
    expect(sent[1].params.codex_ids).toEqual([maraId]);
    const messages = await json(["chat", "message", "list", "--thread", thread.id]);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("How can Mara returning the key show responsibility?");
    expect(await json(["generation", "list"])).toHaveLength(1);
    const reply = messages.find((message: any) => message.role === "assistant");
    const pack = await readFile(join(book.projectRoot, ".openauthor/workspace/chats/context-packs", `${reply.context_used.context_pack.id}.json`), "utf8");
    expect(pack).toContain("CURRENT-PUBLIC-FACT");
    expect(pack).not.toContain("PRIVATE-RECOVERY-NOTE");
    expect(reply.context_used.privacy.one_time_approval).toBe(true);
    expect(reply.context_used.profile.scope).toBe("character");
    expect(requests.filter(request => request.method === "chat.delivery.reconcile")).toHaveLength(1);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});

test("recovers a completed reply after transport loss without re-sending changed context", async ({ page }, testInfo) => {
  let loseResponse = true;
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const book = await localBook(page, {
    beforeSidecar: async (_root, request) => { requests.push({ method: request.method, params: request.params }); },
    afterSidecar: async (_root, request, response) => {
      if (request.method === "chat.send" && loseResponse) {
        loseResponse = false;
        throw new Error("Synthetic transport loss after the engine saved its completed reply");
      }
      return response;
    },
  });
  async function json(args: string[]) {
    const result = await book.core(book.projectRoot, [...args, "--json"]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await page.getByTitle("New thread", { exact: true }).click();
    await page.getByPlaceholder("Type a message... (@ to mention)").fill("Review this original question.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry message" })).toBeVisible();
    const [thread] = await json(["chat", "thread", "list"]);
    const original = await json(["chat", "message", "list", "--thread", thread.id]);
    expect(original).toHaveLength(2);
    await json(["chat", "thread", "update", "--id", thread.id, "--include-current-scene", "false"]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true })).toBeVisible();
    const threadPicker = page.getByTitle("Switch thread", { exact: true });
    if (!await threadPicker.isVisible()) await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
    await threadPicker.click();
    await page.locator(".chat-dropdown__item").filter({ hasText: "New Chat" }).click();
    await page.getByPlaceholder("Type a message... (@ to mention)").fill("A different next question.");
    await page.getByRole("combobox", { name: "Assistant conversation scope" }).selectOption("storyline");
    await page.getByRole("button", { name: "Review current context" }).click();
    await expect(page.getByText("The saved reply was recovered. No new request was sent.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Review AI context" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message... (@ to mention)")).toHaveValue("A different next question.");
    await expect(page.getByRole("combobox", { name: "Assistant conversation scope" })).toHaveValue("storyline");
    await page.screenshot({ path: testInfo.outputPath("completed-reply-reconciled.png") });
    expect(await json(["chat", "message", "list", "--thread", thread.id])).toEqual(original);
    expect(await json(["generation", "list"])).toHaveLength(1);
    expect(requests.filter(request => request.method === "chat.send")).toHaveLength(1);
    expect(requests.filter(request => request.method === "chat.delivery.reconcile")).toHaveLength(1);
    expect(book.errors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
    await book.close();
  }
});
