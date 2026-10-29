// Tiny zero-dependency static server for local development: `npm start` then open http://localhost:8080
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep) || /(^|[\\/])(\.git|node_modules|supabase|scripts|tests)([\\/]|$)/.test(path.relative(root, file))) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(buf);
  });
}).listen(process.env.PORT || 8080, () => console.log("Migrate dev server on http://localhost:" + (process.env.PORT || 8080)));
