# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-accessibility.spec.ts >> dark writing controls expose keyboard focus and readable text
- Location: e2e/editor-accessibility.spec.ts:41:3

# Error details

```
Error: new scene placeholder

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    1.571700956209494
```

```
Error: command palette placeholder

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    1
```

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'New thread', exact: true })

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
  19  |     // Opacity applies to a whole descendant group, including its backgrounds.
  20  |     // Composite each group onto its parent rather than just fading the text.
  21  |     const rendered = (color: number[], index = 0, backdrop = [255, 255, 255]): { foreground: number[]; background: number[] } => {
  22  |       const layer = layers[index];
  23  |       const background = composite(rgba(layer.backgroundColor), backdrop);
  24  |       const content = index + 1 < layers.length
  25  |         ? rendered(color, index + 1, background)
  26  |         : { foreground: composite(color, background), background };
  27  |       const opacity = Number(layer.opacity);
  28  |       return { foreground: composite([...content.foreground, opacity], backdrop), background: composite([...content.background, opacity], backdrop) };
  29  |     };
  30  |     const luminance = (color: number[]) => color.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  31  |     const ratio = (color: number[]) => {
  32  |       const result = rendered(color);
  33  |       const a = luminance(result.foreground), b = luminance(result.background);
  34  |       return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  35  |     };
  36  |     return { color: style.color, background: rendered(foreground).background, opacity: style.opacity, contrast: ratio(foreground), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineContrast: ratio(rgba(style.outlineColor)), focusVisible: node.matches(":focus-visible") };
  37  |   }, pseudo);
  38  | }
  39  | 
  40  | for (const theme of ["dark", "light"] as const) {
  41  |   test(`${theme} writing controls expose keyboard focus and readable text`, async ({ page }, testInfo) => {
  42  |     const book = await localBook(page);
  43  |     const observations: Record<string, unknown> = {};
  44  |     async function readable(name: string, control: Locator, pseudo: "::placeholder" | null = null) {
  45  |       const result = await appearance(control, pseudo);
  46  |       observations[name] = result;
  47  |       expect.soft(result.contrast, name).toBeGreaterThanOrEqual(4.5);
  48  |     }
  49  |     async function visibleFocus(name: string, control: Locator) {
  50  |       for (let step = 0; step < 20 && !(await control.evaluate(node => document.activeElement === node)); step++) await page.keyboard.press("Tab");
  51  |       await expect(control).toBeFocused();
  52  |       const result = await appearance(control);
  53  |       observations[name] = result;
  54  |       expect.soft(result.focusVisible, name).toBe(true);
  55  |       expect.soft(result.outlineStyle, name).not.toBe("none");
  56  |       expect.soft(result.outlineWidth, name).toBeGreaterThanOrEqual(2);
  57  |       expect.soft(result.outlineContrast, name).toBeGreaterThanOrEqual(3);
  58  |     }
  59  |     try {
  60  |       await page.addInitScript(theme => localStorage.setItem("openauthor.theme", JSON.stringify(theme)), theme);
  61  |       await page.goto("/");
  62  |       // Measure settled appearances rather than an intermediate fade from a disabled control.
  63  |       await page.addStyleTag({ content: "* { transition-duration: 0s !important; }" });
  64  |       await page.getByRole("button", { name: "New Project", exact: true }).click();
  65  |       await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard acceptance");
  66  |       await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
  67  |       const create = page.getByRole("button", { name: "Create novel", exact: true });
  68  |       await expect(create).toBeEnabled();
  69  |       await readable("primary button", create);
  70  |       await create.hover();
  71  |       await readable("hovered primary button", create);
  72  |       await create.click();
  73  |       await readable("new scene placeholder", page.getByPlaceholder("New scene title..."), "::placeholder");
  74  |       await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
  75  |       await page.getByRole("button", { name: "Add Scene", exact: true }).click();
  76  |       const title = page.getByRole("textbox", { name: "Scene title", exact: true });
  77  |       const prose = page.getByRole("textbox", { name: "Scene prose", exact: true });
  78  |       await expect(prose).toBeVisible();
  79  |       await page.getByRole("button", { name: "Hide first-run guide" }).click();
  80  |       await page.getByRole("tab", { name: "The Ferry Office", exact: true }).focus();
  81  |       await page.keyboard.press("Tab");
  82  |       await visibleFocus("title keyboard focus", title);
  83  |       await readable("title placeholder", title, "::placeholder");
  84  |       await page.keyboard.press("Tab");
  85  |       await visibleFocus("prose keyboard focus", prose);
  86  |       await readable("prose placeholder", prose, "::placeholder");
  87  |       await page.keyboard.type("Leah kept the ticket folded.");
  88  |       await readable("unsaved status", page.getByText("Unsaved", { exact: true }));
  89  |       await prose.press("ControlOrMeta+s");
  90  |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  91  |       await page.keyboard.press("ControlOrMeta+k");
  92  |       await readable("command palette placeholder", page.getByPlaceholder("Search scenes, entities, commands..."), "::placeholder");
  93  |       await page.keyboard.press("Escape");
  94  |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
> 95  |       await page.getByRole("button", { name: "New thread", exact: true }).click();
      |                                                                           ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
  96  |       const message = page.getByPlaceholder("Type a message... (@ to mention)");
  97  |       await message.fill("Unsent local contrast sample.");
  98  |       const send = page.getByRole("button", { name: "Send", exact: true });
  99  |       await expect(send).toBeEnabled();
  100 |       await readable("enabled AI button", send);
  101 |       await send.hover();
  102 |       await readable("hovered enabled AI button", send);
  103 |       await message.fill("");
  104 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  105 |       await prose.focus();
  106 |       await prose.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  107 |       for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
  108 |       await page.keyboard.press("ControlOrMeta+Shift+z");
  109 |       await readable("unfocused focus-mode Exit", page.getByRole("button", { name: "Exit focus mode", exact: true }));
  110 |       await page.keyboard.press("Tab");
  111 |       await expect(page.getByRole("button", { name: "Exit focus mode", exact: true })).toBeFocused();
  112 |       await page.keyboard.press("Escape");
  113 |       await expect(prose).toBeFocused();
  114 |       await page.keyboard.type("still ");
  115 |       await expect(prose).toHaveValue("Leah still kept the ticket folded.");
  116 |       await prose.press("ControlOrMeta+s");
  117 |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  118 |       await page.screenshot({ path: testInfo.outputPath(`${theme}-writing-focus.png`), animations: "disabled" });
  119 |       await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
  120 |       await readable("Plan metadata", page.getByText("Story architecture", { exact: true }));
  121 |       expect(book.errors).toEqual([]);
  122 |     } finally {
  123 |       await writeFile(testInfo.outputPath("appearance.json"), JSON.stringify(observations, null, 2) + "\n");
  124 |       await book.close();
  125 |     }
  126 |   });
  127 | }
  128 | 
```