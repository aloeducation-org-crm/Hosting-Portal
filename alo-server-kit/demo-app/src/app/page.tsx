export default function Home() {
  return (
    <main className="container">
      <span className="badge">alo-server-kit · L2 Web/App demo</span>
      <h1>ALO Labs Demo App</h1>
      <p>
        This Next.js app is running in PM2 cluster mode behind Nginx on
        <code> alo-server-lap</code>. If you can read this, all four layers
        (security, web/app, nginx, pm2) are healthy.
      </p>
      <p>
        Try the AI gateway at <a href="/ai/v1/models">/ai/v1/models</a> —
        it&apos;s reverse-proxied to LiteLLM on <code>127.0.0.1:4000</code>.
      </p>
      <pre className="code">{`$ curl -u alamin:**** http://localhost/ai/v1/models \\
      -H "Authorization: Bearer $LITELLM_KEY"

=> {"object":"list","data":[
     {"id":"qwen2.5:7b","object":"model",...},
     {"id":"llama3.1:8b","object":"model",...},
     {"id":"gemini-1.5-flash","object":"model",...}
   ]}`}</pre>
      <p>
        Netdata at <a href="/netdata/">/netdata/</a> (LAN-only, basic auth).
        Syncthing at <a href="/syncthing/">/syncthing/</a>.
      </p>
    </main>
  );
}
