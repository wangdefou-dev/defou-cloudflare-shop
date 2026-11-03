# Defou Shop · 得否开源商城

**由得否科技与得否开源维护。X：[得否 @wangdefou](https://x.com/wangdefou)**

一套部署在 Cloudflare 上的通用实物商城。可以卖书籍、文具、服饰、杯具、日用品、手作、数码配件，也可以卖水果和其他农产品。商品目录、名称、价格、规格、分类、单位和图片都能配置。

默认附带笔记本、帆布袋、马克杯三种演示商品，包含前台购买、订单查询、经营后台、库存、优惠券、退款、物流和可选经营通知。源于真实果园项目的果树认领、赞助和果园主题另作为可选示例保留。

**Astro + Preact · Workers · D1 · KV · R2 · Turnstile · Cloudflare Access · Stripe Checkout**

## 三步体验

需要 **Node.js 24 LTS + npm**。本地体验不需要云服务账号。

```bash
git clone https://github.com/wangdefou-dev/defou-cloudflare-shop.git
cd defou-cloudflare-shop
npm ci
npm run setup
npm run dev
```

打开终端显示的地址，默认 [http://127.0.0.1:4321](http://127.0.0.1:4321)，后台在 `/admin`。端口被占用可用 `npm run dev -- --port 4343`；接真实支付时同步修改本地 `.dev.vars` 的 `APP_ORIGIN`。

初始化会建立本地数据库、导入地址字典和商品目录、填入演示库存。你可以购买笔记本等商品，在结果页点“模拟付款成功（不扣款）”，再进后台查看订单与发货。

模拟支付和免登录后台只允许本机回环地址。重复运行 `setup` 会同步本地商品配置并把已上架商品的演示库存重置为 100，保留订单和私密配置。

## 把商品换成自己的

商品向导：

```bash
npm run products
```

可新增、编辑、移除商品。例如把笔记本换成咖啡豆，填写“挂耳咖啡”、`COFFEE_10`、价格、规格“10 包 / 盒”、单位“盒”和自己的商品图片即可。服装的不同颜色、尺码可以配置为不同 SKU。

也可以直接编辑 `config/products.json`：

```json
{
  "sku": "COFFEE_10",
  "slug": "drip-coffee-10",
  "name": "挂耳咖啡",
  "category": "咖啡与食品",
  "unit": "盒",
  "price": 6900,
  "specification": "10 包 / 盒 · 中度烘焙",
  "description": "填写真实商品介绍、材质或成分、使用与保存说明。",
  "image": "/images/coffee.webp",
  "active": true,
  "maxPerOrder": 10
}
```

这是数组中的一个商品对象。价格是人民币整数分，`6900` = ¥69。改完运行 `npm run config:sync`；已有商店还需应用生成的商品更新 SQL 并重新构建，步骤见 [配置参考](docs/配置.md)。新增商品初始库存为 0，在后台设置真实库存即可上架销售。

## 店铺和服务配置

```bash
npm run configure
```

| 想改什么                                                         | 改哪里                                       |
| ---------------------------------------------------------------- | -------------------------------------------- |
| 任意实物商品的名称、规格、价格、单位、分类、图片、限购数量       | `config/products.json` 或 `npm run products` |
| 商店名称、经营者、域名、客服、首页介绍、配送与售后、是否限时销售 | `config/site.json`                           |
| 云资源绑定、Access / Turnstile 公开参数、支付与通知开关          | `wrangler.jsonc` 的 `env.production`         |
| 本地私密配置                                                     | `.dev.vars`，已忽略                          |
| 正式密钥                                                         | Cloudflare Worker Secrets                    |
| 自己的商品图片                                                   | `public/images/`                             |

**开源作者与商店经营者分别展示。** 你可以修改自己的品牌和经营者；项目 README、默认网站页脚和开源声明会标明“得否科技 · 得否开源”，并链接 [X @wangdefou](https://x.com/wangdefou)。署名不代表得否经营或代言使用者的商店。

## 已有能力

- 任意配置的实物商品，支持自定义 SKU、商品页、分类、规格、单位和图片。
- 手机与桌面购买，服务端计价、库存校验、支付创建幂等、签名回调确认付款。
- 优惠券适用于普通零售商品，每单优惠一个购买单位；运费不参与。
- 订单、客户、库存调整审计、发货、私有发票和订单退款。
- 可选快递100轨迹、Telegram 经营通知和访客同意后的统计。
- 配送城市汇总地图，不公开客户详细地址。
- 可选果园主题、果树认领、PIN 登录、分次预约、活动赞助与赠送记录。

当前基础交易是**中文界面、人民币结算、国内地址、每单一种商品规格**。不同规格分别建 SKU。多商品购物车、数字文件自动交付、订阅与多币种尚未内置。

## 部署

1. 创建自己的 D1、KV 和私有 R2 资源。
2. 运行配置向导，填写自己的域名与资源 ID。
3. 应用数据库迁移和种子，设置 Access、Turnstile 和 Worker Secrets。
4. 配好 Stripe Webhook，在隔离测试环境验证后设置真实库存和开售。

完整步骤：[Cloudflare 部署](docs/部署.md) · [配置参考](docs/配置.md) · [架构与安全](docs/架构与安全.md)。真实支付必须使用经营者自己的 Stripe 账号和可用支付方式。

## 常用命令

| 命令                             | 用途                           |
| -------------------------------- | ------------------------------ |
| `npm run setup`                  | 初始化本地演示                 |
| `npm run products`               | 商品配置向导                   |
| `npm run configure`              | 店铺与云资源配置向导           |
| `npm run config:sync`            | 生成配置和 SQL，不操作数据库   |
| `npm run doctor`                 | 检查本地配置                   |
| `npm run doctor -- --production` | 检查生产配置与必需 Secret 名单 |
| `npm run check` / `npm test`     | 类型检查 / 业务测试            |
| `npm run build:production`       | 生产构建、公开页与开源署名检查 |
| `npm run scan:public`            | 凭证与私有文件检查             |
| `npm run deploy`                 | 自检、构建、部署自己的生产环境 |

`npm run dev` 会先构建再启动完整 Worker 预览；改代码后重启即可。`npm run dev:pages` 仅用于页面热更新，不执行自定义 Worker 的完整 API 分流。

## 从果园版升级

已有安装先备份数据库，再应用新增迁移（包含 `0017_generic_catalog.sql`），运行 `npm run config:sync`，检查并应用 `scripts/catalog-update.sql` 后重新部署。更新不清空历史订单、不重置库存；移除的商品下架保留。`paymentProject` 是原付款的归属标识，有真实订单后不要随意改名。

果园功能默认关闭；需要原始主题与果树认领时，把 `features.orchard` 设为 `true`。相关权益仍为平安树 8 箱、富贵树 15 箱；它们属于专用扩展示例，不影响普通商品的配置。

## 开源与作者

**得否科技 · 得否开源**

- 作者 X：[得否 @wangdefou](https://x.com/wangdefou)
- 项目：[Defou Shop](https://github.com/wangdefou-dev/defou-cloudflare-shop)
- 许可：[MIT](LICENSE)，第三方地图和数据见 [许可说明](THIRD_PARTY_NOTICES.md)

开源仓库不含原站密钥、生产资源凭证、客户资料、真实优惠码或私人素材。问题和改进建议可通过仓库 Issue / PR 提交；安全问题请参考 [SECURITY.md](SECURITY.md)。
