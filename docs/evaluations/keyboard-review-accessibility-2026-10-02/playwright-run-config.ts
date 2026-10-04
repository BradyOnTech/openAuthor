import { defineConfig } from "~/Developer/openAuthor/desktop/node_modules/@playwright/test/index.mjs";
import base from "~/Developer/openAuthor/desktop/playwright.config.ts";
export default defineConfig({
  ...base,
  testDir: "~/Developer/openAuthor/desktop/e2e",
  outputDir: "/private/tmp/openauthor-keyboard-acceptance-twzotofw/browser",
  reporter: [["list"], ["json", {outputFile: "/private/tmp/openauthor-keyboard-acceptance-twzotofw/browser-results.json"}]],
  webServer: { ...base.webServer, cwd: "~/Developer/openAuthor/desktop" },
  projects: [
    {name: "chromium", use: {browserName:"chromium", launchOptions:{executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}}},
    {name: "webkit", use: {browserName:"webkit", launchOptions:{executablePath:undefined}}}
  ]
});
