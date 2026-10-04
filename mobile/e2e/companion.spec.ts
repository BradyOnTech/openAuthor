import { test, expect } from "@playwright/test";
import { startShellServer } from "./shellServer";

test("keeps an unfinished capture when checking the manuscript", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample book" }).click();
  await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await page.getByRole("button", { name: "dictated passage", exact: true }).click();
  const draft = "Mara listened for the clock beneath the rain.";
  await page.getByRole("textbox", { name: "Capture text" }).fill(draft);
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("capture-after-navigation.png") });
  await expect(page.getByRole("textbox", { name: "Capture text" })).toHaveValue(draft);
  await page.getByRole("button", { name: "Save pending item" }).click();
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
  await expect(page.getByText("dictated passage", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Capture text" })).toHaveValue("");
});

test("returns to the same scene after capturing an idea", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 550 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample book" }).click();
  await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
  await page.getByRole("button", { name: "Read The Observatory" }).click();
  const prose = page.getByText(/Rain clicked against the copper dome/);
  const offset = await prose.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    if (!parent) throw new Error("Expected a scrollable reader");
    parent.scrollTop = 120;
    return parent.scrollTop;
  });
  expect(offset).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("reading-after-navigation.png") });
  await expect(page.getByRole("button", { name: "Discuss this scene", exact: true })).toBeVisible();
  await expect(page.getByText(/Rain clicked against the copper dome/)).toBeVisible();
  expect(await prose.evaluate((element) => {
    let parent = element.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    return parent?.scrollTop;
  })).toBe(offset);
});

test("warns before leaving a book or signing out with an unfinished capture", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample book" }).click();
  await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  const draft = "Keep this idea until I decide to save it.";
  await page.getByRole("textbox", { name: "Capture text" }).fill(draft);
  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Discard unfinished capture?");
    confirmations++;
    if (confirmations < 3) await dialog.dismiss(); else await dialog.accept();
  });
  await page.getByRole("button", { name: "‹ Projects", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Capture text" })).toHaveValue(draft);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Capture text" })).toHaveValue(draft);
  await page.getByRole("button", { name: "‹ Projects", exact: true }).click();
  await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Capture text" })).toHaveValue("");
  expect(confirmations).toBe(3);
});

test("phone companion reads a scene, keeps preview honest, and reopens its shell offline", async ({ page }, testInfo) => {
  const shell = await startShellServer("dist");
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(shell.origin);
    await expect(page.getByText("Preview only.", { exact: false })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toHaveCount(0);
    await page.getByRole("button", { name: "Explore sample book" }).click();
    await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
    await page.getByRole("button", { name: "Read The Observatory" }).click();
    await expect(page.getByText(/Rain clicked against the copper dome/)).toBeVisible();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Explore sample book" })).toBeVisible();
    await page.getByRole("button", { name: "Explore sample book" }).click();
    await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
    await page.getByRole("button", { name: "Read The Observatory" }).click();
    await page.getByRole("tab", { name: "Assistant", exact: true }).click();
    await expect(page.getByText("Discussing: The Observatory")).toBeVisible();
    await expect(page.getByText("No Writing Voice in this snapshot", { exact: true })).toBeVisible();
    await expect(page.getByText(/Accepted story facts are unavailable in this older snapshot/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start voice" })).toBeDisabled();
    await page.getByRole("tab", { name: "Capture", exact: true }).click();
    await page.getByRole("textbox", { name: "Capture text" }).fill("The key should fit the observatory clock.");
    await page.getByRole("button", { name: "Save pending item" }).click();
    await expect(page.getByText("Pending review", { exact: true })).toBeVisible();
    await expect(page.getByText("The key should fit the observatory clock.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("phone-companion.png"), fullPage: true });
    const manifest = await (await page.request.get(`${shell.origin}/manifest.webmanifest`)).json();
    expect(manifest.display).toBe("standalone");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat();
    });
    expect(cached.some((url) => /index.html$/.test(url))).toBe(true);
    expect(cached.some((url) => /auth|realtime|supabase|snapshot/.test(url))).toBe(false);
    await shell.stop();
    await expect(fetch(shell.origin)).rejects.toThrow();
    await page.reload();
    await expect(page.getByRole("button", { name: "Explore sample book" })).toBeVisible();
    await page.getByRole("button", { name: "Explore sample book" }).click();
    await page.getByRole("button", { name: /The Clockmaker's Map/ }).click();
    await page.getByRole("button", { name: "Read The Observatory" }).click();
    await expect(page.getByText(/Rain clicked against the copper dome/)).toBeVisible();
    await expect(page.getByText(/Scene 1 of 2 · Downloaded scene order/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous scene", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Next scene", exact: true }).click();
    await expect(page.getByText(/Scene 2 of 2 · Downloaded scene order/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Next scene", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Discuss this scene", exact: true }).click();
    await expect(page.getByText("Discussing: Last Train North", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start voice", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  } finally { await shell.stop(); }
});
