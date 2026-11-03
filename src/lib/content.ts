import site from '../../config/site.json';
import { SHOP_IMAGES } from './media';

export const CONTENT_UPDATED = site.contentUpdated;
export { PUBLIC_ORIGIN } from './public-site';
export const PUBLISHER_NAME = site.publisher;
export const BRAND_NAME = site.name;
export const PUBLISHER_TAGLINE = site.publisher + '出品';
export const OWNER_X_URL = site.ownerXUrl;
export const OWNER_WECHAT = site.ownerWechat;
export const WECHAT_QR = {
  src: site.wechatQrUrl,
  width: 850,
  height: 850,
} as const;
export const ORIGIN_LABEL = site.originLabel;
// Approved season prices for static descriptions; checkout always reads D1.
export const SEASON_PRICES = site.prices;
export const APPLE_UNIT_WEIGHTS = { FAMILY: 250, GIFT: 350, PA: 250, FG: 350 } as const;
export const APPLE_PRODUCTS = [
  {
    slug: 'family',
    sku: 'FAMILY',
    name: '家庭装',
    count: 22,
    weight: 250,
    totalKg: 5.5,
    image: SHOP_IMAGES.FAMILY.src,
    imageAlt: SHOP_IMAGES.FAMILY.alt,
    tagline: '把日子，过得脆甜',
    description:
      '22 个苹果一箱，单果约 250g，总重约 5.5kg。适合日常吃、和家人朋友分享，也适合给冰箱补一点秋天。',
  },
  {
    slug: 'gift',
    sku: 'GIFT',
    name: '礼盒装',
    count: 8,
    weight: 350,
    totalKg: 2.8,
    image: SHOP_IMAGES.GIFT.src,
    imageAlt: SHOP_IMAGES.GIFT.alt,
    tagline: '认真挑，慢慢送',
    description:
      '8 个苹果一箱，单果约 350g，总重约 2.8kg。适合送给在意的人，可填写朋友的收件地址，并附一段简短寄语。',
  },
] as const;

export const APPLE_FAQS = [
  [
    '苹果来自哪里？',
    `${BRAND_NAME}的果园位于${ORIGIN_LABEL}。我们分享苹果与农事，不提供果园具体定位和种植者的私人住址。`,
  ],
  [
    '家庭装和礼盒装有什么区别？',
    '家庭装每箱 22 个，单果约 250g，总重约 5.5kg；礼盒装每箱 8 个，单果约 350g，总重约 2.8kg。果重为近似值，具体规格和价格见各商品详情及下单页。',
  ],
  [
    '什么时候开售、多久发货？',
    `销售期为 ${site.season.start} 至 ${site.season.end}。零售订单付款后 48 小时内完成挑选打包，由快递配送；到货时间以实际物流为准。认领箱按预约安排发货。`,
  ],
  [
    '偏远地区怎么寄？',
    '包邮；新疆、西藏、青海、内蒙古、海南等地区按箱补运费差价，默认每箱 ¥20，具体以下单页显示为准。',
  ],
  [
    '收到坏果怎么办？',
    '收货 48 小时内拍照并联系运营。250g 规格每个赔 ¥5，350g 规格每个赔 ¥15，认领箱同样适用，通过 Stripe 原路部分退款。',
  ],
  [
    '可以送人、开票吗？',
    `支持填写朋友的收件地址，礼物可附 60 字以内寄语。发票服务由 ${site.publisher} 按实际资质提供，请先联系运营确认。`,
  ],
  [
    '苹果怎么保存？',
    '收到后先检查，放在阴凉通风处，或冷藏保存。避免与有磕碰的果子混放，尽早享用这一季的新鲜。',
  ],
  [
    '认领一棵苹安树包含什么？',
    `平安树本季共 8 箱，每箱 10 斤，单果约 250g；富贵树本季共 15 箱，每箱 6 斤，单果约 350g。支持专属铭牌和分次预约，可寄往不同地址。本季有效，不自动续费；请在 ${site.season.end} 前完成全部预约。`,
  ],
] as const;
