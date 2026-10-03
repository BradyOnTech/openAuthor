# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-accessibility.spec.ts >> light writing controls expose keyboard focus and readable text
- Location: e2e/editor-accessibility.spec.ts:59:3

# Error details

```
Error: error: Draft generation did not produce a prose change. Make the revision intent more specific or choose a full AI provider.


expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 2
```

# Test source

```ts
  1   | import { test, expect, type Locator } from "@playwright/test";
  2   | import { writeFile } from "node:fs/promises";
  3   | import { localBook } from "./localBook";
  4   | 
  5   | async function appearance(control: Locator, pseudo: "::placeholder" | null = null) {
  6   |   return control.evaluate((node, pseudo) => {
  7   |     const rgba = (value: string) => {
  8   |       const channels = value.match(/[\d.]+/g)?.map(Number);
  9   |       if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${value}`);
  10  |       const scale = value.startsWith("color(srgb ") ? 255 : 1;
  11  |       return [...channels.slice(0, 3).map(channel => channel * scale), channels[3] ?? 1];
  12  |     };
  13  |     const composite = (front: number[], back: number[]) => front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3]));
  14  |     const layers: CSSStyleDeclaration[] = [];
  15  |     for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) layers.unshift(getComputedStyle(ancestor));
  16  |     const style = getComputedStyle(node, pseudo);
  17  |     const foreground = rgba(style.color);
  18  |     if (pseudo) foreground[3] *= Number(style.opacity);
  19  |     const backgrounds = layers.map(layer => {
  20  |       const base = rgba(layer.backgroundColor);
  21  |       if (layer.backgroundImage === "none") return [base];
  22  |       // Bound the Connection Map's single translucent radial gradient by its
  23  |       // component extremes. Unsupported images must not silently disappear.
  24  |       if (!layer.backgroundImage.startsWith("radial-gradient(") || base[3] !== 1) throw new Error(`Unsupported background: ${layer.backgroundImage}`);
  25  |       const stops = layer.backgroundImage.match(/(?:rgba?\([^)]+\)|color\(srgb [^)]+\))/g);
  26  |       if (!stops?.length || layers.some(item => Number(item.opacity) !== 1) || foreground[3] !== 1) throw new Error("Gradient bounds require opaque text and undimmed ancestors.");
  27  |       const colors = stops.map(stop => composite(rgba(stop), base));
  28  |       return [Math.min, Math.max].map(bound => [0, 1, 2].map(channel => bound(...colors.map(color => color[channel]))).concat(1));
  29  |     });
  30  |     // Opacity applies to a whole descendant group, including its backgrounds.
  31  |     // Composite each group onto its parent rather than just fading the text.
  32  |     const rendered = (color: number[], index = 0, backdrop = [255, 255, 255]): { foreground: number[]; background: number[] }[] => {
  33  |       const layer = layers[index];
  34  |       return backgrounds[index].flatMap(fill => {
  35  |         const background = composite(fill, backdrop);
  36  |         const content = index + 1 < layers.length
  37  |           ? rendered(color, index + 1, background)
  38  |           : [{ foreground: composite(color, background), background }];
  39  |         const opacity = Number(layer.opacity);
  40  |         return content.map(result => ({ foreground: composite([...result.foreground, opacity], backdrop), background: composite([...result.background, opacity], backdrop) }));
  41  |       });
  42  |     };
  43  |     const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  44  |     const ratio = (color: number[]) => {
  45  |       const results = rendered(color);
  46  |       const backgrounds = results.map(result => luminance(result.background));
  47  |       const foregrounds = results.map(result => luminance(result.foreground));
  48  |       if (results.length > 1 && Math.min(...foregrounds) <= Math.max(...backgrounds) && Math.max(...foregrounds) >= Math.min(...backgrounds)) return 1;
  49  |       return Math.min(...results.map(result => {
  50  |         const a = luminance(result.foreground), b = luminance(result.background);
  51  |         return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  52  |       }));
  53  |     };
  54  |     return { color: style.color, backgrounds: rendered(foreground).map(result => result.background), opacity: style.opacity, contrast: ratio(foreground), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineContrast: ratio(rgba(style.outlineColor)), focusVisible: node.matches(":focus-visible") };
  55  |   }, pseudo);
  56  | }
  57  | 
  58  | for (const theme of ["dark", "light"] as const) {
  59  |   test(`${theme} writing controls expose keyboard focus and readable text`, async ({ page }, testInfo) => {
  60  |     const book = await localBook(page);
  61  |     const observations: Record<string, unknown> = {};
  62  |     async function json(args: string[]) {
  63  |       const result = await book.core(book.projectRoot, [...args, "--json"]);
> 64  |       expect(result.status, result.stderr).toBe(0);
      |                                            ^ Error: error: Draft generation did not produce a prose change. Make the revision intent more specific or choose a full AI provider.
  65  |       return JSON.parse(result.stdout);
  66  |     }
  67  |     async function readable(name: string, control: Locator, pseudo: "::placeholder" | null = null) {
  68  |       await expect(control).toBeVisible();
  69  |       if (pseudo) {
  70  |         await expect(control).toHaveValue("");
  71  |         expect(await control.evaluate(node => node.matches(":placeholder-shown")), `${name} is visible`).toBe(true);
  72  |       }
  73  |       const result = await appearance(control, pseudo);
  74  |       observations[name] = result;
  75  |       expect.soft(result.contrast, name).toBeGreaterThanOrEqual(4.5);
  76  |     }
  77  |     async function visibleFocus(name: string, control: Locator) {
  78  |       for (let step = 0; step < 20 && !(await control.evaluate(node => document.activeElement === node)); step++) await page.keyboard.press("Tab");
  79  |       await expect(control).toBeFocused();
  80  |       const result = await appearance(control);
  81  |       observations[name] = result;
  82  |       expect.soft(result.focusVisible, name).toBe(true);
  83  |       expect.soft(result.outlineStyle, name).not.toBe("none");
  84  |       expect.soft(result.outlineWidth, name).toBeGreaterThanOrEqual(2);
  85  |       expect.soft(result.outlineContrast, name).toBeGreaterThanOrEqual(3);
  86  |     }
  87  |     try {
  88  |       await page.addInitScript(theme => localStorage.setItem("openauthor.theme", JSON.stringify(theme)), theme);
  89  |       await page.goto("/");
  90  |       // Measure settled appearances rather than an intermediate fade from a disabled control.
  91  |       await page.addStyleTag({ content: "* { transition-duration: 0s !important; animation-duration: 0s !important; }" });
  92  |       await page.getByRole("button", { name: "New Project", exact: true }).click();
  93  |       await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard acceptance");
  94  |       await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
  95  |       const create = page.getByRole("button", { name: "Create novel", exact: true });
  96  |       await expect(create).toBeEnabled();
  97  |       await readable("primary button", create);
  98  |       await create.hover();
  99  |       await readable("hovered primary button", create);
  100 |       await create.click();
  101 |       await readable("new scene placeholder", page.getByPlaceholder("New scene title..."), "::placeholder");
  102 |       await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
  103 |       await page.getByRole("button", { name: "Add Scene", exact: true }).click();
  104 |       const title = page.getByRole("textbox", { name: "Scene title", exact: true });
  105 |       const prose = page.getByRole("textbox", { name: "Scene prose", exact: true });
  106 |       await expect(prose).toBeVisible();
  107 |       await page.getByRole("button", { name: "Hide first-run guide" }).click();
  108 |       await page.getByRole("tab", { name: "The Ferry Office", exact: true }).focus();
  109 |       await page.keyboard.press("Tab");
  110 |       await visibleFocus("title keyboard focus", title);
  111 |       await title.fill("");
  112 |       await readable("title placeholder", title, "::placeholder");
  113 |       await title.fill("The Ferry Office");
  114 |       await page.keyboard.press("Tab");
  115 |       await visibleFocus("prose keyboard focus", prose);
  116 |       await readable("prose placeholder", prose, "::placeholder");
  117 |       await page.keyboard.type("Leah kept the ticket folded.");
  118 |       await readable("unsaved status", page.getByText("Unsaved", { exact: true }));
  119 |       await prose.press("ControlOrMeta+s");
  120 |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  121 |       await page.keyboard.press("ControlOrMeta+k");
  122 |       await readable("command palette placeholder", page.getByPlaceholder("Search scenes, entities, commands..."), "::placeholder");
  123 |       await page.keyboard.press("Escape");
  124 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  125 |       await page.getByTitle("New thread", { exact: true }).click();
  126 |       const message = page.getByPlaceholder("Type a message... (@ to mention)");
  127 |       await message.fill("Unsent local contrast sample.");
  128 |       const send = page.getByRole("button", { name: "Send", exact: true });
  129 |       await expect(send).toBeEnabled();
  130 |       await readable("enabled AI button", send);
  131 |       await send.hover();
  132 |       await readable("hovered enabled AI button", send);
  133 |       await message.fill("");
  134 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  135 |       await prose.focus();
  136 |       await prose.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  137 |       for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
  138 |       await page.keyboard.press("ControlOrMeta+Shift+z");
  139 |       await readable("unfocused focus-mode Exit", page.getByRole("button", { name: "Exit focus mode", exact: true }));
  140 |       await page.keyboard.press("Tab");
  141 |       await expect(page.getByRole("button", { name: "Exit focus mode", exact: true })).toBeFocused();
  142 |       await page.keyboard.press("Escape");
  143 |       await expect(prose).toBeFocused();
  144 |       await page.keyboard.type("still ");
  145 |       await expect(prose).toHaveValue("Leah still kept the ticket folded.");
  146 |       await prose.press("ControlOrMeta+s");
  147 |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  148 |       await page.screenshot({ path: testInfo.outputPath(`${theme}-writing-focus.png`), animations: "disabled" });
  149 |       await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
  150 |       await readable("Plan metadata", page.getByText("Story architecture", { exact: true }));
  151 |       await readable("Plan synopsis placeholder", page.getByRole("textbox", { name: "Synopsis", exact: true }), "::placeholder");
  152 |       await page.getByRole("tab", { name: "The Ferry Office", exact: true }).click();
  153 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  154 |       await page.getByRole("button", { name: "Inspector", exact: true }).click();
  155 |       await readable("Inspector heading", page.getByText("Scene Metadata", { exact: true }));
  156 |       await page.getByRole("button", { name: "Close side panel", exact: true }).click();
  157 |       await page.getByRole("button", { name: "Story Memory (Cmd+Shift+X)", exact: true }).click();
  158 |       await page.getByRole("button", { name: "Connection Map", exact: true }).click();
  159 |       const all = page.locator(".connection-map__filters").getByRole("button", { name: "All", exact: true });
  160 |       await readable("selected Connection Map filter gradient bound", all);
  161 |       await page.screenshot({ path: testInfo.outputPath(`${theme}-connections.png`), animations: "disabled" });
  162 | 
  163 |       const savedScene = await json(["scene", "get", "--id", "scene-0001"]);
  164 |       const proposal = await json(["proposal", "add", "--title", "Contrast review", "--scene", "scene-0001", "--instruction", "Make the prose more concise."]);
```