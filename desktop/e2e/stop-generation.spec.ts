import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { localBook } from "./localBook";

// Stop ends a running AI step instead of waiting for it. The step is held open
// here by another process owning the book lock, which is how a slow provider
// call looks to the interface: a command that has not returned.
test("Stop interrupts a running generation, changes nothing, and Retry resumes it", async ({ page }) => {
  const book = await localBook(page);
  let holder: ReturnType<typeof spawn> | null = null;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Novel title" }).fill("The Lantern Cartographer");
    await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
    await page.getByRole("button", { name: "Create novel" }).click();
    await page.getByPlaceholder("New scene title...").fill("The Moving Map");
    await page.getByRole("button", { name: "Add Scene", exact: true }).click();
    const prose = page.getByRole("textbox", { name: "Scene prose" });
    await prose.fill("Mara unrolled the map beside the lamp. A red line crept across the paper.\n\nAt midnight, the line reached her own door.");
    await prose.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Changes \(/ }).click();
    await page.getByTitle("Create a reviewable Change Set").click();
    await page.getByPlaceholder(/Tighten the pacing/).fill("Make the final paragraph more ominous.");
    await page.getByRole("combobox", { name: /^Provider/ }).selectOption("local");
    await page.getByRole("button", { name: "Create Change Set", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review edit-plan context" })).toBeVisible();
    const generate = page.getByRole("button", { name: "Generate reviewed edit plan", exact: true });
    await expect(generate).toBeEnabled();

    holder = spawn(process.env.OPENAUTHOR_TEST_PYTHON || "python3", ["-c", [
      "import fcntl, os, sys",
      "os.makedirs('.openauthor/workspace/locks', exist_ok=True)",
      "handle = open('.openauthor/workspace/locks/project.lock', 'a+')",
      "fcntl.flock(handle.fileno(), fcntl.LOCK_EX)",
      "print('ready', flush=True)",
      "sys.stdin.read()",
    ].join("\n")], { cwd: book.projectRoot, stdio: ["pipe", "pipe", "inherit"] });
    await once(holder.stdout!, "data");

    await generate.click();
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(page.getByText(/^Stopped\. Completed work is retained; Retry resumes what remains\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry generation", exact: true })).toBeVisible();

    holder.stdin!.end();
    await once(holder, "exit");
    holder = null;
    expect(JSON.parse((await book.core(book.projectRoot, ["proposal", "list", "--json"])).stdout)).toEqual([]);

    await page.getByRole("button", { name: "Retry generation", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review scene draft context" })).toBeVisible();
    expect(JSON.parse((await book.core(book.projectRoot, ["proposal", "list", "--json"])).stdout)).toHaveLength(1);
    expect(book.errors).toEqual([]);
  } finally {
    holder?.kill();
    await book.close();
  }
});
