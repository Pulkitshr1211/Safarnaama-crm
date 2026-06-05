// Extend proxy timeout for long-running AI calls (Claude can take 30-60s for large responses)
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://localhost:3002",
      changeOrigin: true,
      proxyTimeout: 300000,  // 5 minutes
      timeout: 300000,
    })
  );
};
