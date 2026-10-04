import { test } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

async function openSampleBook(app: App, screen: Screen) {
  await app.open("/");
  await expect(screen.getByText("Preview only.", { exact: false })).toBeVisible();
  await screen.getByRole("button", "Explore sample book").click();
  await screen.getByRole("button", /The Clockmaker's Map/).click();
  await expect(screen.getByText("Sample book · voice and sync unavailable")).toBeVisible();
}

test("mobile reader searches prose, handles no results and preserves its scene across tabs", async ({ app, browser, screen }) => {
  await openSampleBook(app, screen);
  const search = screen.getByRole("textbox", "Search scenes");
  await expect(screen.getByRole("button", /^Read /)).toHaveCount(2);
  await search.fill("copper");
  await expect(screen.getByRole("button", /^Read /)).toHaveText([/The Observatory/]);
  await search.fill("Elias");
  await expect(screen.getByRole("button", /^Read /)).toHaveText([/Last Train North/]);
  await search.fill("zebrafish");
  await expect(screen.getByRole("button", /^Read /)).toHaveCount(0);
  await expect(screen.getByText("No matching scenes in this snapshot.")).toBeVisible();
  await search.clear();
  await screen.getByRole("button", "Read The Observatory").click();
  await expect(screen.getByText(/Rain clicked against the copper dome/)).toBeVisible();
  await expect(screen.getByRole("button", "Previous scene")).toBeDisabled();
  await screen.getByRole("button", "Next scene").click();
  await expect(screen.getByText(/The departure board flickered/)).toBeVisible();
  await expect(screen.getByRole("button", "Next scene")).toBeDisabled();
  await screen.getByRole("button", "Discuss this scene").click();
  await expect(screen.getByText("Discussing: Last Train North")).toBeVisible();
  await screen.getByRole("tab", "Capture").click();
  await screen.getByRole("tab", "Scenes").click();
  await expect(screen.getByText(/The departure board flickered/)).toBeVisible();
  await screen.getByRole("button", "Previous scene").click();
  await expect(screen.getByText(/Rain clicked against the copper dome/)).toBeVisible();
  await screen.getByRole("button", "Back to scenes").click();
  await expect(screen.getByRole("button", /^Read /)).toHaveCount(2);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mobile captures every review kind and retains saved items after ordinary sign-out", async ({ app, screen }) => {
  await openSampleBook(app, screen);
  const entries = [
    { kind: "capture note", text: "The observatory clock stops when Mara enters." },
    { kind: "dictated passage", text: "Mara put her palm against the cold copper door." },
    { kind: "story memory suggestion", text: "The blue thread belongs to the clockmaker." },
    { kind: "change set request", text: "Let Elias reach the platform before the last train." },
  ];
  for (const entry of entries) {
    await screen.getByRole("tab", "Capture").click();
    const save = screen.getByRole("button", "Save pending item");
    const capture = screen.getByRole("textbox", "Capture text");
    await expect(save).toBeDisabled();
    await capture.fill("   ");
    await expect(save).toBeDisabled();
    await screen.getByRole("button", entry.kind).click();
    await expect(screen.getByRole("button", entry.kind)).toHaveAttribute("aria-pressed", "true");
    await capture.fill(entry.text);
    await screen.getByRole("tab", "Review").click();
    await screen.getByRole("tab", "Capture").click();
    await expect(capture).toHaveValue(entry.text);
    await expect(screen.getByRole("button", entry.kind)).toHaveAttribute("aria-pressed", "true");
    await save.click();
    await expect(screen.getByRole("tab", "Review")).toHaveAttribute("aria-selected", "true");
    await expect(screen.getByText(entry.text)).toBeVisible();
    await expect(screen.getByText(entry.kind, { visible: true })).toBeVisible();
  }
  for (const entry of entries) await expect(screen.getByText(entry.text)).toBeVisible();
  await screen.getByRole("tab", "Capture").click();
  await expect(screen.getByRole("textbox", "Capture text")).toHaveValue("");
  await screen.getByRole("tab", "Settings").click();
  await screen.getByRole("button", "Sign out").click();
  await screen.getByRole("button", "Explore sample book").click();
  await screen.getByRole("button", /The Clockmaker's Map/).click();
  await screen.getByRole("tab", "Review").click();
  for (const entry of entries) await expect(screen.getByText(entry.text)).toBeVisible();
});

test("mobile protects an unfinished capture when leaving a book or signing out", async ({ app, browser, screen }) => {
  await openSampleBook(app, screen);
  await screen.getByRole("tab", "Capture").click();
  const draft = "Keep the clockmaker's confession until I choose to save it.";
  await screen.getByRole("textbox", "Capture text").fill(draft);
  let decisions = 0;
  await browser.onDialog(async (dialog) => {
    expect(dialog.message).toContain("Discard unfinished capture?");
    decisions++;
    if (decisions < 3) await dialog.dismiss();
    else await dialog.accept();
  });
  await screen.getByRole("button", "‹ Projects").click();
  await expect(screen.getByRole("textbox", "Capture text")).toHaveValue(draft);
  await screen.getByRole("tab", "Settings").click();
  await screen.getByRole("button", "Sign out").click();
  await expect(screen.getByRole("tab", "Settings")).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("tab", "Capture").click();
  await expect(screen.getByRole("textbox", "Capture text")).toHaveValue(draft);
  await screen.getByRole("button", "‹ Projects").click();
  await screen.getByRole("button", /The Clockmaker's Map/).click();
  await screen.getByRole("tab", "Capture").click();
  await expect(screen.getByRole("textbox", "Capture text")).toHaveValue("");
  await screen.getByRole("tab", "Review").click();
  await expect(screen.getByText(draft)).not.toBeVisible();
  expect(decisions).toBe(3);
});

test("mobile preview refuses voice, upload and recovery without contacting hosting", async ({ app, browser, screen }) => {
  const requests: string[] = [];
  await browser.route(/^https:\/\//, async (route) => {
    requests.push(route.request.url);
    await route.abort();
  });
  await openSampleBook(app, screen);
  await screen.getByRole("button", "Read The Observatory").click();
  await screen.getByRole("button", "Discuss this scene").click();
  await expect(screen.getByRole("button", "Start voice")).toBeDisabled();
  await expect(screen.getByText("No Writing Voice in this snapshot")).toBeVisible();
  await screen.getByRole("button", "Show context details").click();
  await expect(screen.getByRole("button", "Hide context details")).toHaveAttribute("aria-expanded", "true");
  await expect(screen.getByText(/Accepted story facts are unavailable in this older snapshot/)).toBeVisible();
  await screen.getByRole("button", "Discuss without a selected scene").click();
  await expect(screen.getByText("Discussing: The Observatory")).not.toBeVisible();
  await screen.getByRole("button", "Hide context details").click();
  await expect(screen.getByRole("button", "Show context details")).toHaveAttribute("aria-expanded", "false");
  await screen.getByRole("tab", "Capture").click();
  const note = "Keep the platform announcement for desktop review.";
  await screen.getByRole("textbox", "Capture text").fill(note);
  await screen.getByRole("button", "Save pending item").click();
  await screen.getByRole("button", "Sync now").click();
  await expect(screen.getByText("Hosted sync is disabled in preview mode.")).toBeVisible();
  await expect(screen.getByText(note)).toBeVisible();
  await screen.getByRole("tab", "Settings").click();
  await screen.getByRole("button", "Reveal recovery key").click();
  await expect(screen.getByText("Recovery keys are available only for hosted encrypted projects.")).toBeVisible();
  await expect(screen.getByRole("button", "Restore recovery key")).toBeDisabled();
  await screen.getByLabel("Recovery key version").fill("1");
  await screen.getByLabel("Recovery key").fill("OA1-synthetic-preview-key");
  await screen.getByRole("button", "Restore recovery key").click();
  await expect(screen.getByText("Recovery keys are available only for hosted encrypted projects.")).toBeVisible();
  expect(requests).toEqual([]);
});

test("mobile device removal requires confirmation and clears its sample review queue", async ({ app, browser, screen }) => {
  await openSampleBook(app, screen);
  await screen.getByRole("tab", "Capture").click();
  const note = "This capture belongs only to the disposable sample device.";
  await screen.getByRole("textbox", "Capture text").fill(note);
  await screen.getByRole("button", "Save pending item").click();
  await expect(screen.getByText(note)).toBeVisible();
  let decisions = 0;
  await browser.onDialog(async (dialog) => {
    expect(dialog.message).toContain("Remove this device?");
    expect(dialog.message).toContain("Unsynced work cannot be recovered.");
    decisions++;
    if (decisions === 1) await dialog.dismiss();
    else await dialog.accept();
  });
  await screen.getByRole("tab", "Settings").click();
  await screen.getByRole("button", "Revoke device and delete local data").click();
  await expect(screen.getByRole("tab", "Settings")).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("tab", "Review").click();
  await expect(screen.getByText(note)).toBeVisible();
  await screen.getByRole("tab", "Settings").click();
  await screen.getByRole("button", "Revoke device and delete local data").click();
  await expect(screen.getByRole("button", "Explore sample book")).toBeVisible();
  await screen.getByRole("button", "Explore sample book").click();
  await screen.getByRole("button", /The Clockmaker's Map/).click();
  await screen.getByRole("tab", "Review").click();
  await expect(screen.getByText(note)).not.toBeVisible();
  await expect(screen.getByText("No items are waiting to upload from this device. Uploaded items may still need desktop review.")).toBeVisible();
  expect(decisions).toBe(2);
});

test("mobile preview clearly resets sample captures after a cold reload", async ({ app, browser, screen }) => {
  await openSampleBook(app, screen);
  await screen.getByRole("tab", "Capture").click();
  const saved = "This sample capture will disappear when the preview reloads.";
  await screen.getByRole("textbox", "Capture text").fill(saved);
  await expect(screen.getByText("Sample capture only. It is not synced and disappears on reload.")).toBeVisible();
  await screen.getByRole("button", "Save pending item").click();
  await expect(screen.getByText(saved)).toBeVisible();
  await screen.getByRole("tab", "Capture").click();
  await screen.getByRole("textbox", "Capture text").fill("An unfinished preview draft.");
  await browser.reload();
  await expect(screen.getByText("Preview only.", { exact: false })).toBeVisible();
  await screen.getByRole("button", "Explore sample book").click();
  await screen.getByRole("button", /The Clockmaker's Map/).click();
  await screen.getByRole("tab", "Capture").click();
  await expect(screen.getByRole("textbox", "Capture text")).toHaveValue("");
  await screen.getByRole("tab", "Review").click();
  await expect(screen.getByText(saved)).not.toBeVisible();
  await expect(screen.getByText("No items are waiting to upload from this device. Uploaded items may still need desktop review.")).toBeVisible();
});
