import http from "node:http";
import httpProxy from "http-proxy";

const PORT = Number(process.env.PORT || 10000);
const UPSTREAM_ORIGIN = (
  process.env.UPSTREAM_ORIGIN ||
  "https://hangji-cargo-watch.hangji-cargo.workers.dev"
).replace(/\/$/, "");

const upstreamUrl = new URL(UPSTREAM_ORIGIN);

const proxy = httpProxy.createProxyServer({
  target: UPSTREAM_ORIGIN,
  changeOrigin: true,
  secure: true,
  xfwd: true,
  ws: true,
  autoRewrite: true,
  protocolRewrite: "https",
  cookieDomainRewrite: "",
  proxyTimeout: 120000,
  timeout: 120000,
});

proxy.on("proxyReq", (proxyReq, req) => {
  const originalHost = req.headers.host || "";
  const forwardedProto = req.headers["x-forwarded-proto"] || "https";

  proxyReq.setHeader("x-forwarded-host", originalHost);
  proxyReq.setHeader("x-forwarded-proto", forwardedProto);

  if (req.headers.origin) {
    proxyReq.setHeader("origin", upstreamUrl.origin);
  }

  if (req.headers.referer) {
    try {
      const referer = new URL(req.headers.referer);
      referer.protocol = upstreamUrl.protocol;
      referer.host = upstreamUrl.host;
      proxyReq.setHeader("referer", referer.toString());
    } catch {
      // Ignore malformed Referer headers and let the proxy continue.
    }
  }
});

proxy.on("proxyRes", (proxyRes, req) => {
  const location = proxyRes.headers.location;
  const publicHost = req.headers.host;

  if (location && publicHost) {
    try {
      const redirectUrl = new URL(location, UPSTREAM_ORIGIN);
      if (redirectUrl.origin === upstreamUrl.origin) {
        redirectUrl.protocol = "https:";
        redirectUrl.host = publicHost;
        proxyRes.headers.location = redirectUrl.toString();
      }
    } catch {
      // Leave relative or malformed Location headers unchanged.
    }
  }
});

proxy.on("error", (error, req, res) => {
  console.error("Proxy error:", error.message);

  if (res && "writeHead" in res) {
    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
    }
    res.end("Cargo Watch upstream temporarily unavailable.");
  }
});

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/_render_proxy_health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, upstream: upstreamUrl.hostname }));
    return;
  }

  proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cargo Watch proxy listening on port ${PORT}`);
  console.log(`Upstream: ${UPSTREAM_ORIGIN}`);
});
