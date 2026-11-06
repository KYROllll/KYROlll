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
      if (!err) { res.writeHead(200, { "Content-Type": contentType, "Accept-Ranges": "bytes", ...cacheHeaders }); res.end(); return; }
      if (err.code === "ENOENT" && allowIndexFallback) { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" }); res.end(); return; }
      sendText(err.code === "ENOENT" ? 404 : 500, "404 Not Found");
    });
    return;
  }

  // Byte ranges are what make the preview player work on Safari / iOS: those
  // browsers refuse to play (and cannot seek) a media file that only answers
  // `200` to a range request. A single range is answered with `206` and a slice
  // streamed from disk; anything malformed gets the standard `416`, so the
  // player's own retry/error state is the only thing a visitor can see.
  fs.stat(filePath, (err, stat) => {
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
    if (!stat.isFile()) { sendText(404, "404 Not Found"); return; }

    const headers = { "Content-Type": contentType, "Accept-Ranges": "bytes", ...cacheHeaders };
    if ((url.searchParams.has("dl") || url.searchParams.has("name")) && ATTACHMENT_EXT.has(ext)) {
      headers["Content-Disposition"] = 'attachment; filename="' + attachmentName(url.searchParams, path.basename(filePath)) + '"';
    }

    const rawRange = req.headers.range;
    const range = rawRange ? /^bytes=(\d*)-(\d*)$/.exec(String(rawRange).trim()) : null;
    if (rawRange && !range) {
      res.writeHead(416, { "Accept-Ranges": "bytes", "Content-Range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    if (range) {
      const size = stat.size;
      let start;
      let end;
      if (range[1] === "") {
        // `bytes=-N`: the last N bytes of the file.
        const suffix = Number(range[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else {
        start = Number(range[1]);
        end = range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        res.writeHead(416, { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
      if (isHead) { res.end(); return; }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }

    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    if (isHead) { res.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`KYROIII store preview server running at http://localhost:${PORT}`);
});
