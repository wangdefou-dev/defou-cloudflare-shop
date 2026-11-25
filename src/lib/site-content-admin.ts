// Admin API for the site content editor: read, publish a new version, restore an old one.
import { z } from 'zod';
import { assert, boundedBody, HttpError } from './security';
import { DEFAULT_STORE, STORE, mergeStore, storeVersion } from './store-config';
import { validateStore } from './store-validate';
import { invalidateSiteContent, loadSiteContent } from './site-content';

const MAX_BYTES = 256 * 1024;

export async function siteContentState(env: Env) {
  await loadSiteContent(env, true);
  const history = await env.DB.prepare(
    'SELECT version,actor,note,created_at FROM site_content_history ORDER BY version DESC LIMIT 30',
  ).all();
  return {
    content: STORE,
    defaults: DEFAULT_STORE,
    version: storeVersion() < 0 ? 0 : storeVersion(),
    history: history.results,
  };
}

async function publish(env: Env, actor: string, expected: number, content: unknown, note: string) {
  const merged = mergeStore(DEFAULT_STORE, content);
  const errors = validateStore(DEFAULT_STORE as any, merged);
  if (errors.length) throw new HttpError(400, '内容有误：' + errors.slice(0, 5).join('；'));
  const data = JSON.stringify(merged);
  assert(data.length <= MAX_BYTES, 413, '内容过大');
  const next = expected + 1;
  // The history row and the live row share the version number, guarded by the expected
  // version in one transaction: a stale editor writes neither.
  const [history] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO site_content_history(version,data,actor,note) SELECT ?,?,?,? WHERE COALESCE((SELECT version FROM site_content WHERE id=1),0)=?',
    ).bind(next, data, actor, note, expected),
    env.DB.prepare(
      'INSERT INTO site_content(id,data,version,actor) SELECT 1,?,?,? WHERE COALESCE((SELECT version FROM site_content WHERE id=1),0)=? ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,actor=excluded.actor,updated_at=CURRENT_TIMESTAMP',
    ).bind(data, next, actor, expected),
  ]);
  assert(history.meta.changes === 1, 409, '网站内容已被其他人修改，请刷新后再保存');
  invalidateSiteContent();
  await loadSiteContent(env, true);
  return { version: next };
}

export async function saveSiteContent(env: Env, actor: string, request: Request) {
  const text = new TextDecoder().decode(await boundedBody(request, MAX_BYTES + 4096));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, '请求格式无效');
  }
  const b = z
    .object({
      version: z.number().int().nonnegative(),
      content: z.record(z.string(), z.unknown()),
      note: z.string().trim().max(100).default(''),
    })
    .strict()
    .parse(body);
  return publish(env, actor, b.version, b.content, b.note);
}

export async function restoreSiteContent(env: Env, actor: string, body: unknown) {
  const b = z
    .object({ version: z.number().int().nonnegative(), restore: z.number().int().positive() })
    .strict()
    .parse(body);
  const row = await env.DB.prepare('SELECT data FROM site_content_history WHERE version=?')
    .bind(b.restore)
    .first<{ data: string }>();
  assert(row, 404, '找不到这个版本');
  return publish(env, actor, b.version, JSON.parse(row.data), `恢复到第 ${b.restore} 版`);
}
