import { PUBLIC_ORIGIN } from './public-site';
import { createRemoteJWKSet, jwtVerify } from 'jose';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function assert(v: unknown, status: number, message: string): asserts v {
  if (!v) throw new HttpError(status, message);
}
export function isDemo(env: Env, request: Request) {
  return (
    env.DEMO_MODE === 'true' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname)
  );
}
export function isSandbox(env: Env, request: Request) {
  const host = new URL(request.url).hostname;
  return (
    env.SANDBOX_CHECKOUT === 'true' &&
    new URL(request.url).origin !== PUBLIC_ORIGIN &&
    env.STRIPE_MODE === 'sandbox' &&
    /^(rk|sk)_test_/.test(env.STRIPE_SECRET_KEY || '') &&
    new URL(env.APP_ORIGIN).hostname === host &&
    (new URL(env.APP_ORIGIN).protocol === 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(host))
  );
}
export async function digest(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function pinHash(pin: string, salt: string = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const b = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 },
    key,
    256,
  );
  return salt + ':' + [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function verifyPin(pin: string, hash: string) {
  return (await pinHash(pin, hash.split(':')[0])) === hash;
}
export async function rateLimit(env: Env, key: string, limit = 15, seconds = 600) {
  const hash = await digest(key);
  const bucket = Math.floor(Date.now() / 1000 / seconds);
  const r = await env.DB.prepare(
    'INSERT INTO rate_limits (key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count',
  )
    .bind(hash, bucket)
    .first<{ count: number }>();
  assert(r && r.count <= limit, 429, '操作频繁，请稍后重试');
}
export async function human(env: Env, request: Request, token?: string) {
  if (isDemo(env, request)) return;
  assert(env.TURNSTILE_SECRET_KEY, 503, '人机验证尚未配置');
  const testKey = env.TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA';
  assert(!testKey || isSandbox(env, request), 503, '正式站点不可使用测试验证密钥');
  assert(token, 400, '请完成人机验证');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get('cf-connecting-ip') || '',
    }),
  });
  const v = (await r.json()) as { success: boolean; hostname: string };
  assert(
    v.success &&
      (v.hostname === new URL(env.APP_ORIGIN).hostname ||
        (testKey && isSandbox(env, request) && v.hostname === 'example.com')),
    400,
    '验证失败，请刷新后重试',
  );
}
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function admin(env: Env, request: Request) {
  if (isDemo(env, request)) return 'local-demo';
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  assert(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && adminEmail, 503, '后台访问保护尚未配置');
  const issuer = 'https://' + env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, '').replace(/\/$/, '');
  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'));
    jwks.set(issuer, keys);
  }
  let email: string;
  try {
    const { payload } = await jwtVerify(
      request.headers.get('cf-access-jwt-assertion') || '',
      keys,
      { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp'] },
    );
    email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  } catch {
    throw new HttpError(401, '请通过 Cloudflare Access 登录运营后台');
  }
  // The edge policy and the origin both restrict access to the named administrator.
  // An account-wide policy change or a valid service-token subject cannot grant admin rights.
  assert(email && email === adminEmail, 403, '当前账号无后台访问权限');
  return email;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  assert(origin === new URL(request.url).origin, 403, '请求来源无效');
}
export async function jsonBody(request: Request) {
  const text = new TextDecoder().decode(await boundedBody(request, 32768));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, '请求格式无效');
  }
}
export async function boundedBody(request: Request, limit: number) {
  assert(Number(request.headers.get('content-length') || 0) <= limit, 413, '提交内容过大');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      assert(size <= limit, 413, '提交内容过大');
      parts.push(item.value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
