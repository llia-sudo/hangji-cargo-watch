# Render reverse proxy for 航迹 Cargo Watch

This directory is an independent Render Web Service entry point. It does **not** replace the existing Cloudflare Worker or D1 database.

## Render settings

- Service type: Web Service
- Region: Singapore
- Root Directory: `render-proxy`
- Build Command: `npm install`
- Start Command: `npm start`
- Instance Type: Free (for initial testing)
- Health Check Path: `/_render_proxy_health`

## Environment variable

Set:

```text
UPSTREAM_ORIGIN=https://hangji-cargo-watch.hangji-cargo.workers.dev
```

The proxy forwards browser requests to the existing Cloudflare Worker and returns the upstream response through Render. It is a reverse proxy, not an HTTP redirect.

After the Render service is verified, bind the custom domain `cargo-watch.siyueyue.cc` to the Render service and point the Alibaba Cloud DNS CNAME record to the Render `*.onrender.com` hostname.
