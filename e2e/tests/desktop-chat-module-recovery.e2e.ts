import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { desktopBook } from "../support/desktopBook.ts";

test("desktop preserves an unsent question after an Assistant module outage and requires fresh review to recover", { tags: ["desktop", "assistant", "recovery", "privacy"], timeout: 90_000 }, async ({ app, browser, screen }) => {
  const book = await desktopBook(browser);
  const eventModule = /\/@tauri-apps_api_event\.js(?:\?|$)/;
  const question = "How can Mara's choice show responsibility?";
  const publicFact = "PUBLIC-RECOVERY-FACT: Mara returns the winter key.";
  const privateNote = "PRIVATE-RECOVERY-NOTE: an unshared author reflection.";
  const expectedReply = "I do not have a scene passage in this turn yet. Open a scene, choose Scene or Book scope, or mention one with `@` so I can make a story-specific recommendation instead of guessing.";
  let droppedModules = 0;
  try {
    await app.open("/");
    await screen.getByRole("button", "New Project").tap();
    await screen.getByRole("textbox", "Novel title").fill("The Lantern Cartographer");
    await screen.getByRole("textbox", "Project folder").fill(book.projectRoot);
    await screen.getByRole("button", "Create novel").tap();
    await expect(screen.getByRole("button", "Add Scene")).toBeVisible();
    await screen.getByRole("button", "Hide first-run guide").tap();
    const mara = await book.json(["codex", "add", "--type", "character", "--name", "Mara", "--description", publicFact, "--notes", privateNote, "--ai-visibility", "ask"]);
    await browser.reload();
    await screen.getByRole("button", "Assistant (Cmd+L)").tap();
    await screen.getByRole("button", "+").tap();
    await screen.getByRole("combobox", "Assistant conversation scope").selectOption({ value: "character" });
    await screen.getByRole("combobox", "Assistant character scope").selectOption({ value: mara.id });
    const [thread] = await book.json(["chat", "thread", "list"]);
    expect(thread.provider).toBe("local");
    await book.json(["chat", "thread", "rename", "--id", thread.id, "--title", "Module recovery"]);
    await screen.getByPlaceholder("Type a message... (@ to mention)").fill(question);
    await screen.getByRole("button", "Send").tap();
    const review = screen.getByRole("region", "Review AI context");
    await expect(review.getByRole("checkbox", "Allow Mara for this turn")).not.toBeChecked();
    await expect(review.getByRole("button", "Send reviewed context")).toBeDisabled();
    await review.getByRole("checkbox", "Allow Mara for this turn").check();
    await expect(review.getByRole("button", "Send reviewed context")).toBeEnabled();
    await review.getByText("Inspect exact initial prompts and history").tap();
    await expect(review).toContainText(publicFact);
    await expect(review).not.toContainText(privateNote);

    // Drop the actual lazy-loaded event module, before any chat.send reaches core.
    await browser.route(eventModule, async route => {
      droppedModules += 1;
      if (droppedModules === 1) await route.abort();
      else await route.continue();
    });
    await review.getByRole("button", "Send reviewed context").tap();
    const recovery = screen.getByRole("status").filter({ hasText: "Your prompt is saved on this device." });
    await expect(recovery).toContainText(question);
    await expect(recovery).toContainText(/module/i);
    await expect(recovery.getByRole("button", "Review current context")).toBeVisible();
    expect(droppedModules).toBe(1);
    expect(await book.json(["chat", "message", "list", "--thread", thread.id])).toEqual([]);
    expect(await book.json(["generation", "list"])).toEqual([]);

    await browser.unroute(eventModule);
    await browser.reload();
    await expect(screen.getByRole("button", "Assistant (Cmd+L)")).toBeVisible();
    const threadPicker = screen.getByRole("button", "No thread ▾");
    if (!await threadPicker.isVisible()) await screen.getByRole("button", "Assistant (Cmd+L)").tap();
    await threadPicker.tap();
    await screen.getByText("Module recovery", { exact: true }).tap();
    await expect(recovery).toContainText(question);
    expect(await book.json(["chat", "message", "list", "--thread", thread.id])).toEqual([]);
    expect(await book.json(["generation", "list"])).toEqual([]);

    await recovery.getByRole("button", "Review current context").tap();
    await expect(review.getByRole("textbox", "Saved question")).toHaveValue(question);
    await expect(review.getByRole("checkbox", "Allow Mara for this turn")).not.toBeChecked();
    await expect(review.getByRole("button", "Send reviewed context")).toBeDisabled();
    expect(await book.json(["generation", "list"])).toEqual([]);
    await review.getByRole("checkbox", "Allow Mara for this turn").check();
    await expect(review.getByRole("button", "Send reviewed context")).toBeEnabled();
    await review.getByText("Inspect exact initial prompts and history").tap();
    await expect(review).toContainText(publicFact);
    await expect(review).not.toContainText(privateNote);
    await review.getByRole("button", "Send reviewed context").tap();
    await expect(screen.getByRole("button", "Save as…")).toBeVisible();
    const messages = await book.json(["chat", "message", "list", "--thread", thread.id]);
    expect(messages).toHaveLength(2);
    expect(messages.find((row: { role: string }) => row.role === "user").content).toBe(question);
    const reply = messages.find((row: { role: string }) => row.role === "assistant");
    expect(reply.content).toBe(expectedReply);
    expect(reply.context_used.codex_entity_ids).toEqual([mara.id]);
    expect(reply.context_used.privacy.one_time_approval).toBe(true);
    expect(await book.json(["generation", "list"])).toHaveLength(1);
    expect(await book.json(["proposal", "list"])).toEqual([]);
    const savedMara = await book.json(["codex", "get", "--id", mara.id]);
    expect(savedMara.ai_visibility).toBe("ask");
    expect(savedMara.notes).toBe(privateNote);
    await expect(recovery).not.toBeVisible();
    expect(await book.errors()).toEqual([]);
  } finally {
    await browser.unroute(eventModule);
    await book.close();
  }
});
