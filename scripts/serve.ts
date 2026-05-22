/**
 * Levanta el endpoint api/check.ts en un servidor HTTP local para probarlo
 * igual que lo haria Vercel (incluida la autenticacion con CRON_SECRET).
 *
 *   npm run serve
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/check
 */
import "dotenv/config";
import http from "node:http";
import handler from "../api/check.js";

const PORT = 3000;

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/check")) {
    res.statusCode = 404;
    res.end("Not found. Usa /api/check");
    return;
  }

  // Adapta el req/res de Node al formato que espera @vercel/node.
  const vReq = req as any;
  vReq.query = Object.fromEntries(new URL(req.url, `http://localhost:${PORT}`).searchParams);

  const vRes = res as any;
  vRes.status = (code: number) => {
    res.statusCode = code;
    return vRes;
  };
  vRes.json = (obj: unknown) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(obj));
    return vRes;
  };

  try {
    await handler(vReq, vRes);
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Endpoint local en http://localhost:${PORT}/api/check`);
});
