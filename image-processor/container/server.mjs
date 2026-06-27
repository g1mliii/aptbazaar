import { createServer } from "node:http";

import { MAX_BYTES, GENERIC_REASON, processImage } from "./process-image.mjs";

// Phase 3.5 step B (native). The sanitize + re-encode logic lives in process-image.mjs so it can be
// unit-tested against crafted bad files (Phase 9.4); this file is the thin HTTP wrapper.

const PORT = 8080;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function reject(res, reason) {
  send(res, 422, JSON.stringify({ reason }), {
    "Content-Type": "application/json"
  });
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) {
      throw new Error("too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/process")) {
    send(res, 404, "not found");
    return;
  }

  void (async () => {
    let buf;
    try {
      buf = await readBody(req);
    } catch {
      reject(res, GENERIC_REASON);
      return;
    }

    const result = await processImage(buf);
    if (!result.ok) {
      reject(res, result.reason);
      return;
    }

    send(res, 200, result.data, {
      "Content-Type": "image/webp",
      "X-Image-Width": String(result.width),
      "X-Image-Height": String(result.height)
    });
  })();
});

server.listen(PORT, () => {
  console.log(`image-processor container listening on ${PORT}`);
});
