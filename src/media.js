// The Stewart Nest — uploaded media in R2: photos, chat voice notes and chat video clips.
// Only plain picture, sound and video formats are accepted; anything else (SVG, HTML…) could carry scripts.
import { json, bad, randomHex } from './util.js';

// key prefix → what it holds. Chat messages keep the key in photo_key; the prefix tells the app how to show it.
const KINDS = {
  p: { label: 'Photo', max: 4, types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } },
  a: { label: 'Voice note', max: 10, types: { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a' } },
  v: { label: 'Video', max: 50, types: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' } },
};
const MB = 1024 * 1024;
const baseType = (t) => (t || '').split(';')[0].trim().toLowerCase();
const kindOfType = (t) => Object.keys(KINDS).find((k) => KINDS[k].types[t]);

// A key the app made itself: p/…, a/… or v/… — used to check keys sent back by phones
export const isMediaKey = (k) => typeof k === 'string' && /^[pav]\/[\w.-]{1,80}$/.test(k);
export const mediaLabel = (k) => KINDS[(k || '')[0]]?.label || 'Photo';

export async function media({ req, env, path, parts, method }) {
  if (parts[0] !== 'photos') return null;

  if (path === 'photos' && method === 'POST') {
    if (!env.PHOTOS) return bad('Photo storage is not set up', 500);
    const type = baseType(req.headers.get('content-type'));
    const kind = kindOfType(type);
    if (!kind) return bad('Send a photo (JPEG, PNG, WebP, GIF), a voice note or a video (MP4, WebM, MOV)');
    const size = Number(req.headers.get('content-length'));
    if (!size) return bad('The upload is empty');
    if (size > KINDS[kind].max * MB) return bad(`${KINDS[kind].label} too big (max ${KINDS[kind].max} MB)`, 413);
    const key = `${kind}/${Date.now()}-${randomHex(6)}.${KINDS[kind].types[type]}`;
    // streamed straight into storage, so a big video never sits in memory
    await env.PHOTOS.put(key, req.body, { httpMetadata: { contentType: type } });
    return json({ key });
  }

  if (method === 'GET') {
    const key = parts.slice(1).join('/');
    if (!isMediaKey(key) || !env.PHOTOS) return bad('Not found', 404);
    // phones ask for parts of a video/voice note (Range); iPhones won't play them otherwise
    const obj = await env.PHOTOS.get(key, { range: req.headers, onlyIf: req.headers });
    if (!obj) return bad('Not found', 404);
    const stored = baseType(obj.httpMetadata?.contentType);
    const safe = kindOfType(stored) ? stored : null;
    const headers = {
      // anything stored before these checks (e.g. an SVG) is handed over as a download, never shown as a page
      'content-type': safe || 'application/octet-stream',
      ...(safe ? {} : { 'content-disposition': 'attachment' }),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
      etag: obj.httpEtag,
    };
    if (!('body' in obj)) return new Response(null, { status: 304, headers }); // unchanged since the phone's copy
    const r = obj.range;
    if (r && req.headers.has('range')) {
      const offset = r.offset ?? (r.suffix != null ? obj.size - r.suffix : 0);
      const length = r.length ?? obj.size - offset;
      return new Response(obj.body, { status: 206, headers: { ...headers, 'content-range': `bytes ${offset}-${offset + length - 1}/${obj.size}`, 'content-length': String(length) } });
    }
    return new Response(obj.body, { headers: { ...headers, 'content-length': String(obj.size) } });
  }
  return null;
}
