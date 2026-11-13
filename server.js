// ALO Acceptance — minimal zero-dependency Node HTTP server.
const http = require("node:http");
const port = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>ALO Acceptance Node</title>
<style>body{font-family:system-ui;margin:4rem auto;max-width:36rem;padding:0 1rem}h1{color:#059669}</style></head>
<body><h1>ALO Acceptance — Node App</h1><p>Serving on port ${port} at ${new Date().toISOString()}.</p>
<p>Deployed automatically by the ALO Hosting Portal from GitHub.</p></body></html>`);
});
server.listen(port, "127.0.0.1", () => console.log(`alo-acceptance listening on 127.0.0.1:${port}`));
