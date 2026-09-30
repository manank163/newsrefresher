// Tiny JSON key-value store for the agent's results.
// On Vercel: Vercel Blob (needs BLOB_READ_WRITE_TOKEN, set automatically when
// a Blob store is connected to the project). Locally: a file in the temp dir.

import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MEMO_MS = 60 * 1000;
const memo = new Map(); // name -> { at, data }

const token = () => process.env.BLOB_READ_WRITE_TOKEN;

// Token format: vercel_blob_rw_<storeId>_<secret>
function blobUrl(name) {
  const storeId = /^vercel_blob_rw_([a-z0-9]+)_/i.exec(token() ?? '')?.[1];
  return storeId ? `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com/${name}` : null;
}

export async function readJson(name, { fresh = false } = {}) {
  const hit = memo.get(name);
  if (!fresh && hit && Date.now() - hit.at < MEMO_MS) return hit.data;
  let data = null;
  try {
    if (token()) {
      const url = blobUrl(name);
      const res = await fetch(`${url}?t=${fresh ? Date.now() : Math.floor(Date.now() / MEMO_MS)}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) data = await res.json();
    } else {
      data = JSON.parse(await readFile(join(tmpdir(), `dealpulse-${name.replace(/\W/g, '_')}`), 'utf8'));
    }
  } catch { data = null; }
  memo.set(name, { at: Date.now(), data });
  return data;
}

export async function writeJson(name, data) {
  const body = JSON.stringify(data);
  if (token()) {
    const { put } = await import('@vercel/blob');
    await put(name, body, {
      access: 'public', addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/json', cacheControlMaxAge: 60,
    });
  } else {
    await writeFile(join(tmpdir(), `dealpulse-${name.replace(/\W/g, '_')}`), body);
  }
  memo.set(name, { at: Date.now(), data });
}
