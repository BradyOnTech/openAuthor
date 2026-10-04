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
Received:    1.3052804284871047
```

```
Error: enabled AI button

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    3.9891468498053047
```

```
Error: hovered enabled AI button

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    3.2420387665350376
```

```
Error: unfocused focus-mode Exit

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    3.210313985761794
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
  45  |       await expect(control).toBeVisible();
  46  |       if (pseudo) {
  47  |         await expect(control).toHaveValue("");
  48  |         expect(await control.evaluate(node => node.matches(":placeholder-shown")), `${name} is visible`).toBe(true);
  49  |       }
  50  |       const result = await appearance(control, pseudo);
  51  |       observations[name] = result;
> 52  |       expect.soft(result.contrast, name).toBeGreaterThanOrEqual(4.5);
      |                                          ^ Error: unfocused focus-mode Exit
  53  |     }
  54  |     async function visibleFocus(name: string, control: Locator) {
  55  |       for (let step = 0; step < 20 && !(await control.evaluate(node => document.activeElement === node)); step++) await page.keyboard.press("Tab");
  56  |       await expect(control).toBeFocused();
  57  |       const result = await appearance(control);
  58  |       observations[name] = result;
  59  |       expect.soft(result.focusVisible, name).toBe(true);
  60  |       expect.soft(result.outlineStyle, name).not.toBe("none");
  61  |       expect.soft(result.outlineWidth, name).toBeGreaterThanOrEqual(2);
  62  |       expect.soft(result.outlineContrast, name).toBeGreaterThanOrEqual(3);
  63  |     }
  64  |     try {
  65  |       await page.addInitScript(theme => localStorage.setItem("openauthor.theme", JSON.stringify(theme)), theme);
  66  |       await page.goto("/");
  67  |       // Measure settled appearances rather than an intermediate fade from a disabled control.
  68  |       await page.addStyleTag({ content: "* { transition-duration: 0s !important; animation-duration: 0s !important; }" });
  69  |       await page.getByRole("button", { name: "New Project", exact: true }).click();
  70  |       await page.getByRole("textbox", { name: "Novel title" }).fill("Keyboard acceptance");
  71  |       await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
  72  |       const create = page.getByRole("button", { name: "Create novel", exact: true });
  73  |       await expect(create).toBeEnabled();
  74  |       await readable("primary button", create);
  75  |       await create.hover();
  76  |       await readable("hovered primary button", create);
  77  |       await create.click();
  78  |       await readable("new scene placeholder", page.getByPlaceholder("New scene title..."), "::placeholder");
  79  |       await page.getByPlaceholder("New scene title...").fill("The Ferry Office");
  80  |       await page.getByRole("button", { name: "Add Scene", exact: true }).click();
  81  |       const title = page.getByRole("textbox", { name: "Scene title", exact: true });
  82  |       const prose = page.getByRole("textbox", { name: "Scene prose", exact: true });
  83  |       await expect(prose).toBeVisible();
  84  |       await page.getByRole("button", { name: "Hide first-run guide" }).click();
  85  |       await page.getByRole("tab", { name: "The Ferry Office", exact: true }).focus();
  86  |       await page.keyboard.press("Tab");
  87  |       await visibleFocus("title keyboard focus", title);
  88  |       await title.fill("");
  89  |       await readable("title placeholder", title, "::placeholder");
  90  |       await title.fill("The Ferry Office");
  91  |       await page.keyboard.press("Tab");
  92  |       await visibleFocus("prose keyboard focus", prose);
  93  |       await readable("prose placeholder", prose, "::placeholder");
  94  |       await page.keyboard.type("Leah kept the ticket folded.");
  95  |       await readable("unsaved status", page.getByText("Unsaved", { exact: true }));
  96  |       await prose.press("ControlOrMeta+s");
  97  |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  98  |       await page.keyboard.press("ControlOrMeta+k");
  99  |       await readable("command palette placeholder", page.getByPlaceholder("Search scenes, entities, commands..."), "::placeholder");
  100 |       await page.keyboard.press("Escape");
  101 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  102 |       await page.getByTitle("New thread", { exact: true }).click();
  103 |       const message = page.getByPlaceholder("Type a message... (@ to mention)");
  104 |       await message.fill("Unsent local contrast sample.");
  105 |       const send = page.getByRole("button", { name: "Send", exact: true });
  106 |       await expect(send).toBeEnabled();
  107 |       await readable("enabled AI button", send);
  108 |       await send.hover();
  109 |       await readable("hovered enabled AI button", send);
  110 |       await message.fill("");
  111 |       await page.getByRole("button", { name: "Assistant (Cmd+L)", exact: true }).click();
  112 |       await prose.focus();
  113 |       await prose.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
  114 |       for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
  115 |       await page.keyboard.press("ControlOrMeta+Shift+z");
  116 |       await readable("unfocused focus-mode Exit", page.getByRole("button", { name: "Exit focus mode", exact: true }));
  117 |       await page.keyboard.press("Tab");
  118 |       await expect(page.getByRole("button", { name: "Exit focus mode", exact: true })).toBeFocused();
  119 |       await page.keyboard.press("Escape");
  120 |       await expect(prose).toBeFocused();
  121 |       await page.keyboard.type("still ");
  122 |       await expect(prose).toHaveValue("Leah still kept the ticket folded.");
  123 |       await prose.press("ControlOrMeta+s");
  124 |       await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  125 |       await page.screenshot({ path: testInfo.outputPath(`${theme}-writing-focus.png`), animations: "disabled" });
  126 |       await page.getByRole("button", { name: "Plan (Cmd+Shift+P)", exact: true }).click();
  127 |       await readable("Plan metadata", page.getByText("Story architecture", { exact: true }));
  128 |       expect(book.errors).toEqual([]);
  129 |     } finally {
  130 |       await writeFile(testInfo.outputPath("appearance.json"), JSON.stringify(observations, null, 2) + "\n");
  131 |       await book.close();
  132 |     }
  133 |   });
  134 | }
  135 | 
```