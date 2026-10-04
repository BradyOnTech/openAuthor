import { test } from "@e2e-dev/mobile";
import { expect, type Screen } from "e2e";

// These tests need a real preview build on a dedicated simulator/emulator.
// Collection verifies configuration; only execution establishes native behavior.
let installed = false;

async function tapButton(screen: Screen, name: string | RegExp) {
  const button = screen.getByRole("button", name);
  await screen.scrollUntilVisible(button);
  await button.tap();
}

test.beforeEach(async ({ app, device, screen }) => {
  if (!installed && process.env.OPENAUTHOR_E2E_NATIVE_APP_PATH) {
    await device.installApp();
    installed = true;
  }
  await app.open();
  await expect(screen.getByText("Preview only.", { exact: false })).toBeVisible();
  await tapButton(screen, "Explore sample book");
  await tapButton(screen, /The Clockmaker's Map/);
  await expect(screen.getByText("Sample book · voice and sync unavailable")).toBeVisible();
});

test("native companion searches and reads scenes with selected context and voice disabled", async ({ device, screen }) => {
  await screen.getByLabel("Search scenes").fill("Elias");
  await device.dismissKeyboard();
  await expect(screen.getByRole("button", /^Read /)).toHaveCount(1);
  await tapButton(screen, "Read Last Train North");
  await expect(screen.getByText(/The departure board flickered/)).toBeVisible();
  await screen.scrollUntilVisible(screen.getByRole("button", "Next scene"));
  await expect(screen.getByRole("button", "Next scene")).toBeDisabled();
  await tapButton(screen, "Previous scene");
  await expect(screen.getByText(/Rain clicked against the copper dome/)).toBeVisible();
  await tapButton(screen, "Discuss this scene");
  await expect(screen.getByText("Discussing: The Observatory")).toBeVisible();
  await expect(screen.getByRole("button", "Start voice")).toBeDisabled();
  await screen.getByLabel("Scenes").tap();
  await expect(screen.getByText(/Rain clicked against the copper dome/)).toBeVisible();
});

test("native companion captures all four kinds for review without changing the manuscript", async ({ device, screen }) => {
  for (const [kind, text] of [
    ["capture note", "Let the clock stop when Mara enters."],
    ["dictated passage", "The rain rang against the copper dome."],
    ["story memory suggestion", "Elias carries the blue thread."],
    ["change set request", "Move the confession before the train arrives."],
  ]) {
    await screen.getByLabel("Capture").tap();
    await expect(screen.getByRole("button", "Save pending item")).toBeDisabled();
    await tapButton(screen, kind);
    await screen.getByLabel("Capture text").fill(text);
    await device.dismissKeyboard();
    await screen.getByLabel("Scenes").tap();
    await screen.getByLabel("Capture").tap();
    await expect(screen.getByLabel("Capture text")).toHaveValue(text);
    await tapButton(screen, "Save pending item");
    await expect(screen.getByLabel("Review")).toBeSelected();
    await expect(screen.getByText(text)).toBeVisible();
  }
  await screen.getByLabel("Scenes").tap();
  await tapButton(screen, "Read The Observatory");
  await expect(screen.getByText("Rain clicked against the copper dome. Beneath the stopped clock, Mara found a brass key wrapped in blue thread.", { exact: false })).toBeVisible();
});

test("native companion protects an unfinished capture through the platform confirmation", async ({ device, screen }) => {
  await screen.getByLabel("Capture").tap();
  const text = "Keep this unfinished native sample capture.";
  await screen.getByLabel("Capture text").fill(text);
  await device.dismissKeyboard();
  await tapButton(screen, "‹ Projects");
  await expect(screen.getByText("Discard unfinished capture?")).toBeVisible();
  await screen.getByRole("button", "Stay").tap();
  await expect(screen.getByLabel("Capture text")).toHaveValue(text);
  await tapButton(screen, "‹ Projects");
  await screen.getByRole("button", "Discard and leave").tap();
  await tapButton(screen, /The Clockmaker's Map/);
  await screen.getByLabel("Capture").tap();
  await expect(screen.getByLabel("Capture text")).toHaveValue("");
});

test("native companion shows privacy controls, refuses preview upload and resets sample work on restart", async ({ app, device, screen }) => {
  await screen.getByLabel("Capture").tap();
  const text = "Disposable native capture for the privacy journey.";
  await screen.getByLabel("Capture text").fill(text);
  await device.dismissKeyboard();
  await tapButton(screen, "Save pending item");
  await tapButton(screen, "Sync now");
  await expect(screen.getByText("Hosted sync is disabled in preview mode.")).toBeVisible();
  await expect(screen.getByText(text)).toBeVisible();
  await screen.getByLabel("Settings").tap();
  await expect(screen.getByText("Foreground voice only")).toBeVisible();
  await expect(screen.getByText("Encrypted mobile data")).toBeVisible();
  await tapButton(screen, "Reveal recovery key");
  await screen.scrollUntilVisible(screen.getByText("Recovery keys are available only for hosted encrypted projects."));
  await expect(screen.getByText("Recovery keys are available only for hosted encrypted projects.")).toBeVisible();
  await tapButton(screen, "Sign out");
  await expect(screen.getByRole("button", "Explore sample book")).toBeVisible();
  await app.restart();
  await expect(screen.getByText("Preview only.", { exact: false })).toBeVisible();
  await tapButton(screen, "Explore sample book");
  await tapButton(screen, /The Clockmaker's Map/);
  await screen.getByLabel("Review").tap();
  await expect(screen.getByText(text)).not.toBeVisible();
});
