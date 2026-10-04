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
    const layers: CSSStyleDeclaration[] = [];
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) layers.unshift(getComputedStyle(ancestor));
    const style = getComputedStyle(node, pseudo);
    const foreground = rgba(style.color);
    if (pseudo) foreground[3] *= Number(style.opacity);
    const backgrounds = layers.map(layer => {
      const base = rgba(layer.backgroundColor);
      if (layer.backgroundImage === "none") return [base];
      // Bound the Connection Map's single translucent radial gradient by its
      // component extremes. Unsupported images must not silently disappear.
      if (!layer.backgroundImage.startsWith("radial-gradient(") || base[3] !== 1) throw new Error(`Unsupported background: ${layer.backgroundImage}`);
      const stops = layer.backgroundImage.match(/(?:rgba?\([^)]+\)|color\(srgb [^)]+\))/g);
      if (!stops?.length || layers.some(item => Number(item.opacity) !== 1) || foreground[3] !== 1) throw new Error("Gradient bounds require opaque text and undimmed ancestors.");
      const colors = stops.map(stop => composite(rgba(stop), base));
      return [Math.min, Math.max].map(bound => [0, 1, 2].map(channel => bound(...colors.map(color => color[channel]))).concat(1));
    });
    // Opacity applies to a whole descendant group, including its backgrounds.
    // Composite each group onto its parent rather than just fading the text.
    const rendered = (color: number[], index = 0, backdrop = [255, 255, 255]): { foreground: number[]; background: number[] }[] => {
      const layer = layers[index];
      return backgrounds[index].flatMap(fill => {
        const background = composite(fill, backdrop);
        const content = index + 1 < layers.length
          ? rendered(color, index + 1, background)
          : [{ foreground: composite(color, background), background }];
        const opacity = Number(layer.opacity);
        return content.map(result => ({ foreground: composite([...result.foreground, opacity], backdrop), background: composite([...result.background, opacity], backdrop) }));
      });
    };
    const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    const ratio = (color: number[]) => {
      const results = rendered(color);
      const backgrounds = results.map(result => luminance(result.background));
      const foregrounds = results.map(result => luminance(result.foreground));
      if (results.length > 1 && Math.min(...foregrounds) <= Math.max(...backgrounds) && Math.max(...foregrounds) >= Math.min(...backgrounds)) return 1;
      return Math.min(...results.map(result => {
        const a = luminance(result.foreground), b = luminance(result.background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      }));
    };
    return { color: style.color, backgrounds: rendered(foreground).map(result => result.background), opacity: style.opacity, contrast: ratio(foreground), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineContrast: ratio(rgba(style.outlineColor)), focusVisible: node.matches(":focus-visible") };
  }, pseudo);
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme} writing controls expose keyboard focus and readable text`, async ({ page }, testInfo) => {
    const book = await localBook(page);
    const observations: Record<string, unknown> = {};
    async function json(args: string[]) {
      const result = await book.core(book.projectRoot, [...args, "--json"]);
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    }
    async function readable(name: string, control: Locator, pseudo: "::placeholder" | null = null) {
      await expect(control).toBeVisible();
      if (pseudo) {
        await expect(control).toHaveValue("");
        expect(await control.evaluate(node => node.matches(":placeholder-shown")), `${name} is visible`).toBe(true);
      }
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
      await page.addStyleTag({ content: "* { transition-duration: 0s !important; animation-duration: 0s !important; }" });
      await page.getByRole("button", { name: "New Project", exact: true }).click();
      await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard acceptance");
      await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
      const create = page.getByRole("button", { name: "Create novel", exact: true });
      await expect(create).toBeEnabled();
      await readable("primary button", create);
      await create.hover();
      await readable("hovered primary button", create);
      await create.click();
      await readable("new scene placeholder", page.getByPlaceholder("New scene title..."), "::placeholder");
      await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
      await page.getByRole("button", { name: "Add Scene", exact: true }).click();
      const title = page.getByRole("textbox", { name: "Scene title", exact: true });
      const prose = page.getByRole("textbox", { name: "Scene prose", exact: true });
      await expect(prose).toBeVisible();
      await page.getByRole("button", { name: "Hide first-run guide" }).click();
      await page.getByRole("tab", { name: "The Ferry Office", exact: true }).focus();
      await page.keyboard.press("Tab");
      await visibleFocus("title keyboard focus", title);
      await title.fill("");
      await readable("title placeholder", title, "::placeholder");
      await title.fill("The Ferry Office");
      await page.keyboard.press("Tab");
      await visibleFocus("prose keyboard focus", prose);
      await readable("prose placeholder", prose, "::placeholder");
      await page.keyboard.type("Leah kept the ticket folded.");
      await readable("unsaved status", page.getByText("Unsaved", { exact: true }));
      await prose.press("ControlOrMeta+s");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      await readable("command palette placeholder", page.getByPlaceholder("Search scenes, entities, commands..."), "::placeholder");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
      await page.getByTitle("New thread", { exact: true }).click();
      const message = page.getByPlaceholder("Type a message... (@ to mention)");
      await message.fill("Unsent local contrast sample.");
      const send = page.getByRole("button", { name: "Send", exact: true });
      await expect(send).toBeEnabled();
      await readable("enabled AI button", send);
      await send.hover();
      await readable("hovered enabled AI button", send);
      await message.fill("");
      await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
      await prose.focus();
      await prose.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
      for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await readable("unfocused focus-mode Exit", page.getByRole("button", { name: "Exit focus mode", exact: true }));
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
      await readable("Plan synopsis placeholder", page.getByRole("textbox", { name: "Synopsis", exact: true }), "::placeholder");
      await page.getByRole("tab", { name: "The Ferry Office", exact: true }).click();
      await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
      await page.getByRole("button", { name: "Inspector", exact: true }).click();
      await readable("Inspector heading", page.getByText("Scene Metadata", { exact: true }));
      await page.getByRole("button", { name: "Close side panel", exact: true }).click();
      await page.getByRole("button", { name: "Story Memory (Cmd+Shift+X)", exact: true }).click();
      await page.getByRole("button", { name: "Connection Map", exact: true }).click();
      const all = page.locator(".connection-map__filters").getByRole("button", { name: "All", exact: true });
      await readable("selected Connection Map filter gradient bound", all);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-connections.png`), animations: "disabled" });

      const reviewScene = await json(["scene", "add", "--title", "Review passage", "--body", "The signal began to drift."]);
      const savedScene = await json(["scene", "get", "--id", reviewScene.id]);
      const proposal = await json(["proposal", "add", "--title", "Contrast review", "--scene", reviewScene.id, "--instruction", "Make the prose more concise."]);
      const draft = await json(["proposal", "draft", "--id", proposal.id, "--provider", "local"]);
      expect(draft.change_set.hunks.length).toBeGreaterThan(0);
      await page.reload();
      await page.addStyleTag({ content: "* { transition-duration: 0s !important; animation-duration: 0s !important; }" });
      await page.getByRole("button", { name: "Changes (Cmd+Shift+R)", exact: true }).click();
      await readable("Revision History heading", page.getByText("Revision History", { exact: true }));
      await page.getByRole("button", { name: /^Contrast review —/ }).click();
      const included = page.getByRole("button", { name: "Exclude change hunk 1", exact: true });
      await expect(included).toBeEnabled();
      await readable("included hunk", included);
      await included.hover();
      await readable("hovered included hunk", included);
      const apply = page.getByRole("button", { name: /^Apply \d+ changes?$/ });
      await expect(apply).toBeEnabled();
      await apply.hover();
      await readable("hovered enabled Apply", apply);
      await readable("BEFORE status", page.getByText("BEFORE", { exact: true }).first());
      await readable("AFTER status", page.getByText("AFTER", { exact: true }).first());
      await included.click();
      const excluded = page.getByRole("button", { name: "Include change hunk 1", exact: true });
      await expect(excluded).toBeEnabled();
      await readable("excluded hunk remains interactive", excluded);
      const hunk = excluded.locator("../..").locator("..");
      const comment = hunk.getByRole("button", { name: "Comment", exact: true });
      await expect(comment).toBeEnabled();
      await readable("excluded hunk Comment", comment);
      await comment.click();
      await readable("excluded hunk comment placeholder", page.getByRole("textbox", { name: "Revision comment for hunk 1", exact: true }), "::placeholder");
      expect(await json(["scene", "get", "--id", reviewScene.id])).toEqual(savedScene);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-excluded-review.png`), animations: "disabled" });
      expect(book.errors).toEqual([]);
    } finally {
      await writeFile(testInfo.outputPath("appearance.json"), JSON.stringify(observations, null, 2) + "\n");
      await book.close();
    }
  });
}
