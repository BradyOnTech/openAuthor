import { test, expect, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { localBook } from "./localBook";

async function appearance(control: Locator, pseudo: "::placeholder" | null = null) {
  return control.evaluate((node, pseudo) => {
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
      const scale = value.startsWith("color(srgb ") ? 255 : 1;
      return [...channels.slice(0, 3).map(channel => channel * scale), channels[3] ?? 1];
    };
    const composite = (front: number[], back: number[]) => front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3]));
    const layers: number[][] = [];
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) layers.push(rgba(getComputedStyle(ancestor).backgroundColor));
    let background = [255, 255, 255];
    for (const layer of layers.reverse()) background = composite(layer, background);
    const style = getComputedStyle(node, pseudo);
    const foreground = rgba(style.color);
    foreground[3] *= Number(style.opacity);
    const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    const ratio = (color: number[]) => {
      const a = luminance(composite(color, background)), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    return { color: style.color, background, opacity: style.opacity, contrast: ratio(foreground), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineContrast: ratio(rgba(style.outlineColor)), focusVisible: node.matches(":focus-visible") };
  }, pseudo);
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme} writing controls expose keyboard focus and readable text`, async ({ page }, testInfo) => {
    const book = await localBook(page);
    const observations: Record<string, unknown> = {};
    async function readable(name: string, control: Locator, pseudo: "::placeholder" | null = null) {
      const result = await appearance(control, pseudo);
      observations[name] = result;
      expect.soft(result.contrast, name).toBeGreaterThanOrEqual(4.5);
    }
    async function visibleFocus(name: string, control: Locator) {
      for (let step = 0; step < 20 && !(await control.evaluate(node => document.activeElement === node)); step++) await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      const result = await appearance(control);
      observations[name] = result;
      expect.soft(result.focusVisible, name).toBe(true);
      expect.soft(result.outlineStyle, name).not.toBe("none");
      expect.soft(result.outlineWidth, name).toBeGreaterThanOrEqual(2);
      expect.soft(result.outlineContrast, name).toBeGreaterThanOrEqual(3);
    }
    try {
      await page.addInitScript(theme => localStorage.setItem("openauthor.theme", JSON.stringify(theme)), theme);
      await page.goto("/");
      // Measure settled appearances rather than an intermediate fade from a disabled control.
      await page.addStyleTag({ content: "* { transition-duration: 0s !important; }" });
      await page.getByRole("button", { name: "New Project", exact: true }).click();
      await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard acceptance");
      await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
      const create = page.getByRole("button", { name: "Create novel", exact: true });
      await expect(create).toBeEnabled();
      await readable("primary button", create);
      await create.hover();
      await readable("hovered primary button", create);
      await create.click();
      await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
      await page.getByRole("button", { name: "Add Scene", exact: true }).click();
      const title = page.getByRole("textbox", { name: "Scene title", exact: true });
      const prose = page.getByRole("textbox", { name: "Scene prose", exact: true });
      await expect(prose).toBeVisible();
      await page.getByRole("button", { name: "Hide first-run guide" }).click();
      await page.getByRole("tab", { name: "The Ferry Office", exact: true }).focus();
      await page.keyboard.press("Tab");
      await visibleFocus("title keyboard focus", title);
      await readable("title placeholder", title, "::placeholder");
      await page.keyboard.press("Tab");
      await visibleFocus("prose keyboard focus", prose);
      await readable("prose placeholder", prose, "::placeholder");
      await page.keyboard.type("Leah kept the ticket folded.");
      await readable("unsaved status", page.getByText("Unsaved", { exact: true }));
      await prose.press("ControlOrMeta+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await prose.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
      for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Exit focus mode", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(prose).toBeFocused();
      await page.keyboard.type("still ");
      await expect(prose).toHaveValue("Leah still kept the ticket folded.");
      await prose.press("ControlOrMeta+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${theme}-writing-focus.png`), animations: "disabled" });
      await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
      await readable("Plan metadata", page.getByText("Story architecture", { exact: true }));
      expect(book.errors).toEqual([]);
    } finally {
      await writeFile(testInfo.outputPath("appearance.json"), JSON.stringify(observations, null, 2) + "\n");
      await book.close();
    }
  });
}
