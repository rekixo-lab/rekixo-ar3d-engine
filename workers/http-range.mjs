function invalidRange(size) {
  return {
    error: true,
    status: 416,
    headers: {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
    },
  };
}

export function parseSingleByteRange(header, size) {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0) throw Error("Invalid object size.");
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return invalidRange(size);
  if (size === 0) return invalidRange(size);

  const [, startText, endText] = match;
  if (!startText && !endText) return invalidRange(size);

  let start;
  let end;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalidRange(size);
    const length = Math.min(suffix, size);
    start = size - length;
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size)
      return invalidRange(size);
    if (!endText) {
      end = size - 1;
    } else {
      end = Number(endText);
      if (!Number.isSafeInteger(end) || end < start) return invalidRange(size);
      end = Math.min(end, size - 1);
    }
  }

  return {
    error: false,
    offset: start,
    length: end - start + 1,
    start,
    end,
  };
}

export async function serveR2Object(
  bucket,
  key,
  request,
  {
    mimeType = "application/octet-stream",
    cacheControl = "public, max-age=300, must-revalidate",
    expectedSize,
    sha256,
    allowRange = false,
    verifyStoredChecksum = false,
  } = {},
) {
  const head = await bucket.head(key);
  if (!head) return { missing: true };
  // Optional strict mode for immutable original-image releases. R2 upload
  // stores the SHA-256 in customMetadata; never present a mismatched object
  // under an authoritative published checksum.
  if (verifyStoredChecksum && (!/^[a-f0-9]{64}$/i.test(String(sha256 || "")) ||
      String(head.customMetadata?.sha256 || "").toLowerCase() !== String(sha256).toLowerCase())) {
    return { corruption: `Published asset checksum metadata mismatch for ${key}.` };
  }
  if (
    expectedSize !== undefined &&
    Number.isFinite(Number(expectedSize)) &&
    Number(expectedSize) !== Number(head.size)
  )
    return {
      corruption: `Object size mismatch for ${key}.`,
    };

  const headers = new Headers();
  head.writeHttpMetadata?.(headers);
  headers.set("Content-Type", mimeType || headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", head.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (sha256) headers.set("X-Rekixo-SHA256", sha256);
  if (allowRange) headers.set("Accept-Ranges", "bytes");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(head.size));
    return { response: new Response(null, { status: 200, headers }) };
  }

  const range = allowRange
    ? parseSingleByteRange(request.headers.get("range"), Number(head.size))
    : null;
  if (range?.error) {
    for (const [name, value] of Object.entries(range.headers))
      headers.set(name, value);
    return {
      response: new Response(null, {
        status: range.status,
        headers,
      }),
    };
  }

  const object = range
    ? await bucket.get(key, {
        range: {
          offset: range.offset,
          length: range.length,
        },
      })
    : await bucket.get(key);
  if (!object) return { missing: true };

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set("Content-Length", String(range.length));
    return {
      response: new Response(object.body, {
        status: 206,
        headers,
      }),
    };
  }

  headers.set("Content-Length", String(head.size));
  return {
    response: new Response(object.body, {
      status: 200,
      headers,
    }),
  };
}
