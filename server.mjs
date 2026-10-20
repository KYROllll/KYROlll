import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = 8080;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".aiff": "audio/aiff",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain"
};

// Extensions a visitor is meant to keep, not view. These are only answered as
// an attachment when the request asks for one (`dl`/`name`), so the inline
// preview player streaming the very same `.wav`/`.mp3` files keeps working.
const ATTACHMENT_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".aiff", ".flac", ".ogg", ".zip", ".pdf"]);

// A download URL may carry `?name=` with the friendly name `catalog.js` gives
// the file; strip anything that could break the header and fall back to the
// path's own basename.
function attachmentName(params, fallback) {
  const base = String(params.get("name") || "").trim() || fallback;
  const clean = base.replace(/[\r\n"]/g, "").replace(/[\\/]+/g, "-").trim().slice(0, 160);
  return clean || fallback;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch (err) { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("400 Bad Request"); return; }

  let reqPath;
  try { reqPath = decodeURIComponent(url.pathname); }
  catch (err) { reqPath = url.pathname; }

  const filePath = path.join(__dirname, reqPath === "/" ? "index.html" : reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const isHead = req.method === "HEAD";
  /* The storefront's scripts and styles are cache-busted with `?v=N`, and those
     URLs change on every edit. HTML and the unversioned entry points are
     revalidated so a browser (Safari included) can never keep an old page that
     still points at an old `downloads.js`. `/assets` are versioned too, so this
     only ever costs a conditional request, never a re-download of a file whose
     URL has not changed. */
  const cacheHeaders = (ext === ".html" || ext === ".js" || ext === ".mjs" || ext === ".css")
    ? { "Cache-Control": "no-cache" }
    : {};

  // Never let a missing file fall through to the storefront: a substituted
  // index.html is exactly what turns a dead download link into "a webpage
  // opened". Only extension-less routes (SPA-style) may fall back to index.html.
  const allowIndexFallback = ext === "" && !reqPath.startsWith("/assets/");

  const sendText = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/plain" });
    res.end(isHead ? undefined : message);
  };

  // HEAD (the download page's availability probe) only needs to know the file
  // exists — no point reading a 38 MB WAV to answer it.
  if (isHead) {
    fs.stat(filePath, (err) => {
      if (!err) { res.writeHead(200, { "Content-Type": contentType, ...cacheHeaders }); res.end(); return; }
      if (err.code === "ENOENT" && allowIndexFallback) { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" }); res.end(); return; }
      sendText(err.code === "ENOENT" ? 404 : 500, "404 Not Found");
    });
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT" && allowIndexFallback) {
        fs.readFile(path.join(__dirname, "index.html"), (err2, content2) => {
          if (err2) { sendText(404, "404 Not Found"); return; }
          res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
          res.end(isHead ? undefined : content2);
        });
      } else if (err.code === "ENOENT") {
        sendText(404, "404 Not Found");
      } else {
        sendText(500, "500 Internal Server Error");
      }
      return;
    }

    const headers = { "Content-Type": contentType, ...cacheHeaders };
    if ((url.searchParams.has("dl") || url.searchParams.has("name")) && ATTACHMENT_EXT.has(ext)) {
      headers["Content-Disposition"] = 'attachment; filename="' + attachmentName(url.searchParams, path.basename(filePath)) + '"';
    }
    res.writeHead(200, headers);
    res.end(isHead ? undefined : content);
  });
});

server.listen(PORT, () => {
  console.log(`KYROIII store preview server running at http://localhost:${PORT}`);
});
