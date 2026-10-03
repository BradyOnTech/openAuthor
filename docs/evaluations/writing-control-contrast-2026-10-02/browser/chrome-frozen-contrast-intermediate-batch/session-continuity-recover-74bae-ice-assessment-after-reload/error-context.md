# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-continuity.spec.ts >> recovers Plan text, reading position and an unfinished voice assessment after reload
- Location: e2e/session-continuity.spec.ts:50:1

# Error details

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Writing Voice', exact: true })

```

# Test source

```ts
  27  |       await expect(page.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue("Unfinished navigation notes.");
  28  |       await expect.soft(plan, "restored Plan navigation").toHaveAttribute("aria-pressed", "true");
  29  |       await expect.soft(manuscript, "inactive Manuscript navigation").toHaveAttribute("aria-pressed", "false");
  30  | 
  31  |       // A tool sidebar can intentionally stay open beside a different document.
  32  |       await search.click();
  33  |       await expect(search).toHaveAttribute("aria-pressed", "true");
  34  |       if (!cachedProjectId) await page.evaluate(() => localStorage.removeItem("openauthor.activeProjectId"));
  35  |       await page.reload();
  36  |       await expect(page.getByRole("tab", { name: "Plan", exact: true })).toHaveAttribute("aria-selected", "true");
  37  |       await expect.soft(search, "restored explicit Search navigation").toHaveAttribute("aria-pressed", "true");
  38  |       await expect.soft(plan, "document restoration does not select Plan sidebar").toHaveAttribute("aria-pressed", "false");
  39  |       const savedPlan = await book.core(book.projectRoot, ["plan", "get", "--json"]);
  40  |       expect(savedPlan.status, savedPlan.stderr).toBe(0);
  41  |       expect(JSON.parse(savedPlan.stdout).brief.synopsis).toBe("");
  42  |       expect(book.errors).toEqual([]);
  43  |       await page.screenshot({ path: testInfo.outputPath("restored-navigation.png") });
  44  |     } finally {
  45  |       await book.close();
  46  |     }
  47  |   });
  48  | }
  49  | 
  50  | test("recovers Plan text, reading position and an unfinished voice assessment after reload", async ({ page }, testInfo) => {
  51  |   test.setTimeout(90_000);
  52  |   const book = await localBook(page);
  53  |   async function json(args: string[]) {
  54  |     const result = await book.core(book.projectRoot, [...args, "--json"]);
  55  |     expect(result.status, result.stderr).toBe(0);
  56  |     return JSON.parse(result.stdout);
  57  |   }
  58  |   try {
  59  |     await page.goto("/");
  60  |     await page.getByRole("button", { name: "New Project", exact: true }).click();
  61  |     await page.getByRole("textbox", { name: "Novel title" }).fill("The Harbor Notebook");
  62  |     await page.getByRole("textbox", { name: "Project folder" }).fill(book.projectRoot);
  63  |     await page.getByRole("button", { name: "Create novel" }).click();
  64  |     await expect(page.getByRole("button", { name: "Add Scene", exact: true })).toBeVisible();
  65  |     const excerpt = 'Mara held the brake. "Use your belt," Ivo said. She threw it toward the boy.';
  66  |     await json(["scene", "add", "--title", "Dawn", "--body", excerpt]);
  67  |     const longProse = Array.from({ length: 35 }, (_, i) => `Passage ${i + 1}. Mara checked the rope against the quay. The tide had not reached the painted mark. She sat beside the empty winch and listened to the water beneath its housing.`).join("\n\n");
  68  |     await json(["scene", "add", "--title", "Dusk", "--body", longProse]);
  69  |     const act = await json(["plan", "act-add", "--title", "Harbor"]);
  70  |     const first = await json(["plan", "chapter-add", "--act", act.id, "--title", "Morning"]);
  71  |     const last = await json(["plan", "chapter-add", "--act", act.id, "--title", "Evening"]);
  72  |     await json(["plan", "scene-assign", "--scene", "scene-0001", "--chapter", first.id]);
  73  |     await json(["plan", "scene-assign", "--scene", "scene-0002", "--chapter", last.id]);
  74  |     const before = await json(["scene", "get", "--id", "scene-0002"]);
  75  |     await page.reload();
  76  |     await page.getByRole("button", { name: "Hide first-run guide" }).click();
  77  |     await page.getByRole("button", { name: /^Plan \(/ }).click();
  78  |     await page.getByRole("textbox", { name: "Synopsis", exact: true }).fill("Unfinished thoughts about the missing ferry.");
  79  |     await page.getByPlaceholder("New act title").fill("Return to the harbor");
  80  |     await page.getByPlaceholder("Chapter title").fill("The unsealed letter");
  81  |     await page.getByRole("textbox", { name: "New beat for Dawn" }).fill("Mara refuses to let go.");
  82  |     const dawn = page.locator("article").filter({ has: page.getByRole("button", { name: "Dawn", exact: true }) });
  83  |     await dawn.getByText("Story time & labels", { exact: true }).click();
  84  |     await dawn.getByRole("textbox", { name: "Story time for Dawn" }).fill("Day 3, dawn");
  85  |     await page.reload();
  86  |     await page.getByRole("button", { name: /^Plan \(/ }).click();
  87  |     await expect(page.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue("Unfinished thoughts about the missing ferry.");
  88  |     await expect(page.getByPlaceholder("New act title")).toHaveValue("Return to the harbor");
  89  |     await expect(page.getByPlaceholder("Chapter title")).toHaveValue("The unsealed letter");
  90  |     await expect(page.getByRole("textbox", { name: "New beat for Dawn" })).toHaveValue("Mara refuses to let go.");
  91  |     await dawn.getByText("Story time & labels", { exact: true }).click();
  92  |     await expect(dawn.getByRole("textbox", { name: "Story time for Dawn" })).toHaveValue("Day 3, dawn");
  93  |     const savedPlan = await json(["plan", "get"]);
  94  |     expect(savedPlan.brief.synopsis).toBe("");
  95  |     expect(savedPlan.acts).toHaveLength(1);
  96  |     expect(savedPlan.beats).toHaveLength(0);
  97  |     await page.screenshot({ path: testInfo.outputPath("recovered-plan.png") });
  98  | 
  99  |     await page.getByRole("button", { name: /^Manuscript \(/ }).click();
  100 |     await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
  101 |     await expect(page.getByRole("main", { name: "Manuscript reading copy" })).toBeVisible();
  102 |     await page.getByRole("combobox", { name: "Reading chapter" }).selectOption(last.id);
  103 |     const reader = page.locator(".manuscript-reader");
  104 |     await reader.evaluate((element) => { element.scrollTop = 700; });
  105 |     await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
  106 |     const scroll = await reader.evaluate((element) => element.scrollTop);
  107 |     await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith(":reading") && JSON.parse(localStorage.getItem(key)!).offset !== null))).toBe(true);
  108 |     await page.reload();
  109 |     await page.getByRole("button", { name: /^Manuscript \(/ }).click();
  110 |     await page.getByRole("button", { name: "Read manuscript", exact: true }).click();
  111 |     await expect(page.getByRole("combobox", { name: "Reading chapter" })).toHaveValue(last.id);
  112 |     await expect.poll(() => reader.evaluate((element, target) => Math.abs(element.scrollTop - target), scroll)).toBeLessThan(8);
  113 |     await page.screenshot({ path: testInfo.outputPath("resumed-reading.png") });
  114 | 
  115 |     await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
  116 |     await page.getByRole("button", { name: "Writing Voice", exact: true }).click();
  117 |     await page.getByRole("combobox", { name: "Writing provider", exact: true }).selectOption("local");
  118 |     await page.getByRole("combobox", { name: "Preview scene" }).selectOption("scene-0001");
  119 |     await page.getByRole("textbox", { name: /Exact excerpt/ }).fill(excerpt);
  120 |     await page.getByRole("button", { name: "Compare 3 short previews", exact: true }).click();
  121 |     const sample = page.getByRole("article").first();
  122 |     await sample.getByText("Your quality assessment", { exact: true }).click();
  123 |     await sample.getByRole("textbox", { name: "Assessment notes" }).fill("Check whether Ivo's suggestion sounds like him.");
  124 |     await sample.getByRole("combobox").first().selectOption("needs_revision");
  125 |     await page.reload();
  126 |     if (await page.getByRole("button", { name: "Writing Voice", exact: true }).count() === 0) await page.getByRole("button", { name: "Assistant (Cmd+L)" }).click();
> 127 |     await page.getByRole("button", { name: "Writing Voice", exact: true }).click();
      |                                                                            ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
  128 |     await expect(sample.getByRole("textbox", { name: "Assessment notes" })).toHaveValue("Check whether Ivo's suggestion sounds like him.");
  129 |     await expect(sample.getByRole("combobox").first()).toHaveValue("needs_revision");
  130 |     expect((await json(["style", "workspace"])).previews[0].directions[0].author_review.notes).toBe("");
  131 |     await sample.scrollIntoViewIfNeeded();
  132 |     await page.screenshot({ path: testInfo.outputPath("recovered-assessment.png") });
  133 |     expect(await json(["scene", "get", "--id", "scene-0002"])).toEqual(before);
  134 |     expect(book.errors).toEqual([]);
  135 |   } finally {
  136 |     if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("last-screen.png") }).catch(() => {});
  137 |     await book.close();
  138 |   }
  139 | });
  140 | 
```