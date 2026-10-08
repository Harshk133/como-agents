const http = require("http");
const httpProxy = require("http-proxy");

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const PORT = Number(process.env.PORT || 10000);

const CAMOFOX_TARGET = "http://127.0.0.1:9377";
const VNC_TARGET = "http://127.0.0.1:6080";

const CAMOFOX_ACCESS_KEY = process.env.CAMOFOX_ACCESS_KEY;

// Your Vercel frontend URL.
// During local development this can be:
// http://localhost:3000
const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function addCorsHeaders(req, res) {
  const origin = req.headers.origin;

  // Only allow your frontend.
  if (origin === FRONTEND_URL) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Useful when caches/proxies are involved.
  res.setHeader("Vary", "Origin");
}

function injectCamofoxAuth(req) {
  if (!CAMOFOX_ACCESS_KEY) {
    console.warn(
      "[gateway] CAMOFOX_ACCESS_KEY is not configured"
    );
    return;
  }

  req.headers.authorization = `Bearer ${CAMOFOX_ACCESS_KEY}`;
}

// --------------------------------------------------
// Proxy error handling
// --------------------------------------------------

proxy.on("error", (err, req, res) => {
  console.error("[proxy error]", err.message);

  // HTTP proxy response
  if (res && !res.headersSent) {
    res.writeHead(502, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        error: "Bad Gateway",
        message: err.message,
      })
    );
  }
});

// --------------------------------------------------
// HTTP server
// --------------------------------------------------

const server = http.createServer((req, res) => {
  const originalUrl = req.url;

  console.log(
    `[gateway] ${req.method} ${originalUrl}`
  );

  // ------------------------------------------------
  // CORS
  // ------------------------------------------------

  addCorsHeaders(req, res);

  // ------------------------------------------------
  // OPTIONS / CORS preflight
  // ------------------------------------------------

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ------------------------------------------------
  // Gateway health check
  // ------------------------------------------------

  if (req.url === "/gateway/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        ok: true,
        service: "camofox-gateway",
      })
    );

    return;
  }

  // ------------------------------------------------
  // VNC status
  //
  // IMPORTANT:
  // Do NOT proxy this to Camofox.
  // Camofox may require authentication and return 401.
  // ------------------------------------------------

  if (req.url === "/vnc/status") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });

    res.end(
      JSON.stringify({
        enabled: true,
        running: true,
      })
    );

    return;
  }

  // ------------------------------------------------
  // Camofox API
  //
  // /api/foo
  //     ↓
  // Camofox /foo
  //
  // Add CAMOFOX_ACCESS_KEY server-side.
  // NEVER expose this key to the browser.
  // ------------------------------------------------

  if (req.url.startsWith("/api/")) {
    req.url = req.url.replace(/^\/api/, "") || "/";

    injectCamofoxAuth(req);

    console.log(
      `[gateway] API -> ${CAMOFOX_TARGET}${req.url}`
    );

    proxy.web(req, res, {
      target: CAMOFOX_TARGET,
      changeOrigin: true,
    });

    return;
  }

  // ------------------------------------------------
  // noVNC HTTP
  //
  // /vnc/vnc.html
  //     ↓
  // /vnc.html
  //
  // /vnc/app/...
  //     ↓
  // /app/...
  // ------------------------------------------------

  if (req.url.startsWith("/vnc/")) {
    req.url =
      req.url.replace(/^\/vnc/, "") || "/";

    console.log(
      `[gateway] VNC -> ${VNC_TARGET}${req.url}`
    );

    proxy.web(req, res, {
      target: VNC_TARGET,
      changeOrigin: true,
    });

    return;
  }

  // ------------------------------------------------
  // Default route
  // ------------------------------------------------

  res.writeHead(200, {
    "Content-Type": "application/json",
  });

  res.end(
    JSON.stringify({
      status: "ok",
      service: "camofox-gateway",
      routes: {
        api: "/api/*",
        vnc: "/vnc/*",
        vncStatus: "/vnc/status",
      },
    })
  );
});

// --------------------------------------------------
// WebSocket / noVNC
// --------------------------------------------------

server.on("upgrade", (req, socket, head) => {
  console.log(
    `[gateway] WebSocket ${req.url}`
  );

  // Only allow VNC websocket connections.
  if (!req.url.startsWith("/vnc/")) {
    console.warn(
      `[gateway] rejected websocket: ${req.url}`
    );

    socket.destroy();
    return;
  }

  // Convert:
  //
  // /vnc/websockify
  //
  // into:
  //
  // /websockify
  //

  req.url =
    req.url.replace(/^\/vnc/, "") || "/";

  console.log(
    `[gateway] WebSocket VNC -> ws://127.0.0.1:6080${req.url}`
  );

  proxy.ws(
    req,
    socket,
    head,
    {
      target: "ws://127.0.0.1:6080",
      changeOrigin: true,
    }
  );
});

// --------------------------------------------------
// Start
// --------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[gateway] Listening on 0.0.0.0:${PORT}`
  );

  console.log(
    `[gateway] Camofox: ${CAMOFOX_TARGET}`
  );

  console.log(
    `[gateway] VNC: ${VNC_TARGET}`
  );

  console.log(
    `[gateway] Frontend: ${FRONTEND_URL}`
  );

  console.log(
    `[gateway] Access key configured: ${
      CAMOFOX_ACCESS_KEY ? "YES" : "NO"
    }`
  );
});