// server.ts — HTTP server bootstrap. Zero external deps.

import { createServer } from "node:http";
import { route } from "./router.ts";

const PORT = Number(process.env["PORT"] ?? 4319);
const HOST = process.env["HOST"] ?? "127.0.0.1";

export function startServer(port = PORT, host = HOST) {
  const server = createServer((req, res) => {
    void route(req, res);
  });
  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host}:${actualPort}`;
      resolve({ server, url });
    });
  });
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().then(({ url }) => {
    console.log(`Muhanai Agent OS server listening on ${url}`);
    console.log(`Try: curl ${url}/skill.md`);
    console.log(`Try: curl ${url}/health`);
  });
}
