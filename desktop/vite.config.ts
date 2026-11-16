import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { CONTENT_SECURITY_POLICY } from "./contentSecurityPolicy";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    // Keep the Vite 6 targets for the supported macOS 12 WebView.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"]
  },
  server: {
    port: 5173,
    strictPort: true
  },
  // The production build is previewed under the packaged app's policy.
  preview: {
    headers: { "Content-Security-Policy": CONTENT_SECURITY_POLICY }
  }
});
