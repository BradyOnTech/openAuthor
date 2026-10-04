import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

// A real, disposable origin lets service workers handle connection refusal.
// WebKit's Playwright offline emulation rejects navigation before that fallback.
export async function startShellServer(directory: string) {
  const root = resolve(directory);
  const contentTypes: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const path = resolve(root, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
      if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(path);
      response.writeHead(200, { "content-type": contentTypes[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolveStarted, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveStarted);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The disposable shell server did not allocate a TCP port.");
  let stopping: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop() {
      if (!stopping) {
        stopping = new Promise<void>((resolveStopped, reject) => {
          server.close(error => error ? reject(error) : resolveStopped());
          server.closeAllConnections();
        });
      }
      return stopping;
    },
  };
}
