export default {
  root: "/private/tmp/openauthor-supabase-upgrade-review",
  resolve: { alias: { vitest: "/private/tmp/openauthor-desktop-grouped-updates/desktop/node_modules/vitest/dist/index.js" } },
  test: { include: ["protocol-old-sdk.test.ts"], environment: "node", maxWorkers: 1, testTimeout: 5000, reporters: ["default"] },
};
