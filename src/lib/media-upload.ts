// Uploads to R2 (served at /media/). Images are re-encoded without metadata; PDFs (invoices)
// are only accepted from the operations admin and stay private.
import { assert, boundedBody, HttpError } from './security';
import { sanitizeImage } from './image-sanitize';

const id = () => crypto.randomUUID();
export async function uploadMedia(
  env: Env,
  request: Request,
  options: { allowPdf: boolean; source: 'admin' | 'studio' },
) {
  assert(
    Number(request.headers.get('content-length') || 0) <= 6 * 1024 * 1024,
    413,
    '文件最大 5MB',
  );
  const form = await new Response((await boundedBody(request, 6 * 1024 * 1024)) as BodyInit, {
    headers: { 'content-type': request.headers.get('content-type') || '' },
  }).formData();
  const f = form.get('file');
  assert(f instanceof File && f.size <= 5 * 1024 * 1024, 400, '请上传 5MB 内的图片或 PDF');
  assert(
    [
      'image/jpeg',
      'image/png',
      'image/webp',
      ...(options.allowPdf ? ['application/pdf'] : []),
    ].includes(f.type),
    400,
    options.allowPdf ? '仅支持 JPG、PNG、WebP、PDF' : '仅支持 JPG、PNG、WebP 图片',
  );
  let bytes = new Uint8Array(await f.arrayBuffer());
  const valid =
    f.type === 'image/png'
      ? bytes[0] === 137 && bytes[1] === 80
      : f.type === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216
        : f.type === 'image/webp'
          ? new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
          : new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  assert(valid, 400, '文件内容与格式不匹配');
  if (f.type !== 'application/pdf') {
    try {
      bytes = sanitizeImage(bytes, f.type).bytes as Uint8Array<ArrayBuffer>;
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : '图片无效');
    }
  }
  const key =
    'apple-2026/' +
    id() +
    '.' +
    { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[
      f.type
    ];
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: f.type },
    customMetadata: { source: options.source },
  });
  return { url: '/media/' + key };
}
