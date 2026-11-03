type AssetFetcher = { fetch(request: Request): Promise<Response> };

const imagePath = /^\/(?:images|brand)\/[a-z0-9][a-z0-9/_-]*\.(?:avif|webp|png|jpe?g|svg|ico)$/i;
const buildPath = /^\/_astro\/[a-z0-9/_-]+\.[a-z0-9_-]{8,}\.(?:js|css|woff2?)$/i;
const fingerprint = /^\/images\/optimized\/[a-z0-9-]+-[a-f0-9]{12}\.(?:avif|webp|ico)$/;
const versionedBrand = /^\/brand\/orchard-v\d+\//;
const mapFingerprint = /^\/images\/maps\/china-(?:admin-)?gs\d{4}-\d+-[a-f0-9]{12}\.jpg$/;

// Only bundled public files use this path. Pages, APIs and uploaded media never do.
export async function bundledAsset(request: Request, assets: AssetFetcher) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const path = new URL(request.url).pathname;
  const image = imagePath.test(path);
  const region = /^\/regions\/v1-[a-f0-9]{12}\/(?:root|[0-9]{6})\.json$/.test(path);
  const mapLicense = path === '/images/maps/licenses.txt';
  if (!image && !region && !mapLicense && !buildPath.test(path)) return;

  // Forward the actual request: conditional, HEAD and Range headers must survive.
  const response = await assets.fetch(request);
  const headers = new Headers(response.headers);
  const type = headers.get('content-type') || '';
  const validType = region
    ? type.startsWith('application/json')
    : mapLicense
      ? type.startsWith('text/plain')
      : image
        ? type.startsWith('image/')
        : /^(?:text\/css|(?:application|text)\/javascript|(?:application|font)\/)/i.test(type);
  const cacheable =
    [200, 206, 304].includes(response.status) &&
    (validType || (response.status === 304 && headers.has('etag'))) &&
    !headers.has('set-cookie');
  headers.set(
    'cache-control',
    cacheable
      ? region ||
        fingerprint.test(path) ||
        mapFingerprint.test(path) ||
        versionedBrand.test(path) ||
        buildPath.test(path)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400'
      : 'no-store',
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
