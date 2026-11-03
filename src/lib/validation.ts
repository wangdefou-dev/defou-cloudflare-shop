import { z } from 'zod';
import { chinaDate, SEASON_END, SPONSOR_MIN_HEADCOUNT } from './shared';
export const phone = z.string().regex(/^1[3-9]\d{9}$/, '请输入 11 位中国大陆手机号');
export const address = z.object({
  recipient: z.string().trim().min(1).max(30),
  phone,
  province_code: z.string().regex(/^\d{6}$/),
  city_code: z.string().regex(/^\d{6}$/),
  district_code: z.string().regex(/^\d{6}$/),
  province: z.string().max(30),
  city: z.string().max(40),
  district: z.string().max(40),
  address: z.string().trim().min(5, '详细地址至少 5 个字').max(200),
  card_message: z.string().max(60).default(''),
  sender: z.string().max(30).default(''),
});
export const invoice = z
  .object({
    type: z.enum(['none', 'personal', 'company']).default('none'),
    title: z.string().max(100).default(''),
    tax_no: z.string().max(30).default(''),
    email: z.string().default(''),
  })
  .superRefine((v, c) => {
    if (v.type !== 'none') {
      if (!v.title.trim()) c.addIssue({ code: 'custom', message: '请填写发票抬头' });
      if (!z.email().safeParse(v.email).success)
        c.addIssue({ code: 'custom', message: '请填写发票接收邮箱' });
      if (v.type === 'company' && !/^[A-Z0-9]{15,20}$/i.test(v.tax_no))
        c.addIssue({ code: 'custom', message: '请填写有效企业税号' });
    }
  });
export const checkout = z
  .object({
    request_id: z.uuid().optional(),
    type: z.enum(['retail', 'adoption']),
    sku: z.enum(['FAMILY', 'GIFT', 'PA', 'FG']),
    qty: z.number().int().min(1).max(20),
    phone,
    address: address.optional(),
    plate_name: z.string().trim().min(1).max(12).optional(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    invoice,
    agreed: z.literal(true),
    turnstile: z.string().optional(),
    coupon_code: z.string().trim().max(40).optional(),
    payment_method: z.enum(['auto', 'alipay', 'card']).default('auto'),
  })
  .superRefine((v, c) => {
    if (v.type === 'adoption' && v.coupon_code)
      c.addIssue({ code: 'custom', message: '优惠券仅限零售苹果，不适用于果树认领' });
    if (v.type === 'retail' && (!v.address || !['FAMILY', 'GIFT'].includes(v.sku)))
      c.addIssue({ code: 'custom', message: '请填写完整收件信息' });
    if (
      v.type === 'adoption' &&
      (!v.pin || !v.plate_name || !['PA', 'FG'].includes(v.sku) || v.qty !== 1)
    )
      c.addIssue({ code: 'custom', message: '请填写铭牌和 6 位 PIN，认领每单一棵' });
  });
export const booking = z.object({
  qty: z.number().int().min(1).max(18),
  address,
  expected_date: z
    .string()
    .refine(
      (x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= chinaDate(2) && x <= SEASON_END,
      `发货日期须在两天后至 ${SEASON_END} 之间`,
    ),
  turnstile: z.string().optional(),
  payment_method: z.enum(['auto', 'alipay', 'card']).default('auto'),
});
export const sponsor = z.object({
  org_name: z.string().trim().min(2).max(60),
  event_name: z.string().trim().min(2).max(100),
  event_date: z
    .string()
    .refine(
      (x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x > chinaDate(5) && x <= SEASON_END,
      `活动须晚于今天 5 天，最晚 ${SEASON_END}`,
    ),
  headcount: z
    .number()
    .int()
    .min(SPONSOR_MIN_HEADCOUNT, `预计参加人数至少为 ${SPONSOR_MIN_HEADCOUNT} 人`)
    .max(100000),
  contact: z.string().trim().min(1).max(30),
  phone,
  wechat: z.string().max(50).default(''),
  address,
  reason: z.string().trim().min(30, '申请理由至少 30 字').max(2000),
  link: z
    .string()
    .max(1000)
    .refine((x) => !x || z.url().safeParse(x).success, '请填写完整链接')
    .default(''),
  agree_photos: z.literal(true),
  turnstile: z.string().optional(),
});
