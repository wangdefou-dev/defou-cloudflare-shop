import { z } from 'zod';
import { assert } from './security';

const RETAIL = ['FAMILY', 'GIFT'];
export { PRODUCT_IMAGE } from './product-image';
import { PRODUCT_IMAGE } from './product-image';
const FIELDS = [
  'name',
  'price',
  'unit_weight_g',
  'count_per_box',
  'tagline',
  'description',
  'image_url',
] as const;
type Content = {
  name: string;
  price: number;
  unit_weight_g: number | null;
  count_per_box: number | null;
  tagline: string;
  description: string;
  image_url: string | null;
};

export const productContentInput = z
  .object({
    id: z.enum(['FAMILY', 'GIFT', 'PA', 'FG']),
    content_revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(20),
    // Integer cents, ¥1 – ¥100,000.
    price: z.number().int().min(100).max(10_000_000),
    unit_weight_g: z.number().int().min(1).max(5000),
    count_per_box: z.number().int().min(1).max(500),
    tagline: z.string().trim().max(40),
    description: z.string().trim().max(300),
    image_url: z.string().regex(PRODUCT_IMAGE).nullable(),
    reason: z.string().trim().max(160).default(''),
  })
  .strict();

/**
 * Saves name / price / specs / copy / image for one product. Orders keep their own amounts, so a
 * price change only affects orders created afterwards. Adoption box counts are fixed by the
 * adoption rules, so count_per_box is only editable for retail boxes.
 */
export async function saveProductContent(env: Env, actor: string, body: unknown) {
  const p = productContentInput.parse(body);
  const current = await env.DB.prepare(
    `SELECT ${FIELDS.join(',')},content_revision FROM products WHERE id=?`,
  )
    .bind(p.id)
    .first<Content & { content_revision: number }>();
  assert(current, 404, '商品不存在');
  assert(
    current.content_revision === p.content_revision,
    409,
    '商品信息已被其他人修改，请刷新后再编辑',
  );
  const next: Content = {
    name: p.name,
    price: p.price,
    unit_weight_g: p.unit_weight_g,
    count_per_box: RETAIL.includes(p.id) ? p.count_per_box : current.count_per_box,
    tagline: p.tagline,
    description: p.description,
    image_url: p.image_url,
  };
  const changed = FIELDS.filter((k) => current[k] !== next[k]);
  assert(changed.length, 400, '没有需要保存的修改');
  assert(current.price === next.price || p.reason.length >= 2, 400, '修改价格请填写原因');
  const before = Object.fromEntries(changed.map((k) => [k, current[k]]));
  const after = Object.fromEntries(changed.map((k) => [k, next[k]]));
  // The change log is written first under the same revision guard, so a stale form writes
  // neither the log nor the product (D1 batches run in one transaction).
  const [, updated] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO product_changes(id,product_id,actor,before_json,after_json,reason) SELECT ?,id,?,?,?,? FROM products WHERE id=? AND content_revision=?',
    ).bind(
      crypto.randomUUID(),
      actor,
      JSON.stringify(before),
      JSON.stringify(after),
      p.reason,
      p.id,
      p.content_revision,
    ),
    env.DB.prepare(
      `UPDATE products SET ${FIELDS.map((k) => k + '=?').join(',')},content_revision=content_revision+1,content_updated_at=CURRENT_TIMESTAMP WHERE id=? AND content_revision=?`,
    ).bind(...FIELDS.map((k) => next[k]), p.id, p.content_revision),
  ]);
  // meta.changes also counts the product_revision trigger write when the price changed.
  assert(updated.meta.changes > 0, 409, '商品信息已被其他人修改，请刷新后再编辑');
  return { changed };
}

export async function productChanges(env: Env, productId: string) {
  return (
    await env.DB.prepare(
      'SELECT actor,before_json,after_json,reason,created_at FROM product_changes WHERE product_id=? ORDER BY created_at DESC LIMIT 20',
    )
      .bind(productId)
      .all()
  ).results;
}
