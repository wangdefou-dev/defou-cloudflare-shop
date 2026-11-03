# Cloudflare Orchard Shop 🍎

把果园小店部署到 Cloudflare：苹果零售、果树认领、活动赞助和一个能管理日常经营的后台。

基于实际使用中的 Cloudflare 版本整理。开源副本使用示例品牌与本地演示素材，不包含原站账号、密钥、客户资料、优惠码清单、生产数据库或提交历史。你可以换成自己的品牌和配置，保留这套经营流程。

**Astro + Preact · Workers · D1 · KV · R2 · Turnstile · Access · Stripe Checkout**

## 先在本地跑起来

需要 **Node.js 24 LTS + npm**。本地体验不需要 Cloudflare、Stripe 或 Telegram 账号。

```bash
git clone https://github.com/wangdefou-dev/cloudflare-orchard-shop.git
cd cloudflare-orchard-shop
npm ci
npm run setup
npm run dev
```

打开终端显示的地址，默认 [http://127.0.0.1:4321](http://127.0.0.1:4321)，后台在 `/admin`。端口被占用时以预览服务日志为准；也可用 `npm run dev -- --port 4343` 指定空闲端口。接真实支付时同步修改 `.dev.vars` 的 `APP_ORIGIN`。

`setup` 会创建本地配置、应用数据库迁移、导入行政区划、初始化四款商品，并填入本地演示库存。它只操作本地数据库。可下演示订单，在支付结果页模拟付款，再进后台查看订单和发货；果树认领可设置 PIN、登录和预约。

模拟支付和免登录后台仅允许 `localhost / 127.0.0.1 / ::1`。演示不会调用真实收款、退款、物流或通知服务。重复运行 `setup` 保留配置和订单，但会把本地库存重置为 100。

`npm run dev` 会先构建，再启动包含 API 和后台的完整 Worker 预览。改代码后重启即可。仅调整静态页面、需要热更新时，可用 `npm run dev:pages`；该模式不执行自定义 Worker 的 API 路由。

## 换成自己的小店

运行交互向导：

```bash
npm run configure
```

或者直接改下面的文件：

| 想改什么 | 改哪里 |
| --- | --- |
| 品牌、经营者、域名、客服微信、销售日期、四款商品价格、偏远运费、地图出发城市 | `config/site.json` |
| Worker 名、D1 / KV / R2 资源、Access / Turnstile 公开参数、功能开关 | `wrangler.jsonc` 的 `env.production` |
| 本地私密配置 | `.dev.vars`，已忽略 |
| 正式密钥 | Cloudflare Worker Secrets |
| 商品与场景图片 | `public/images/` + `src/lib/image-assets.json` |
| 首页故事、商品规格、售后与发票文案 | `src/pages/` + `src/lib/content.ts` |

修改 `config/site.json` 后运行 `npm run config:sync`。价格单位是**人民币分**，例如 `10800` = ¥108。同步会生成初始化 SQL 和已有商店的更新 SQL，不会访问数据库或覆盖库存。

默认销售期给本地体验留出宽限；正式使用前必须设置真实销售截止日和履约约定。图片自带 DEMO 标记，上线前替换为自己的授权商品图片，核实规格、产地、运费、坏果赔付和发票资质。

完整说明：[配置参考](docs/配置.md) · [Cloudflare 部署](docs/部署.md) · [架构与安全](docs/架构与安全.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

## 部署到 Cloudflare

1. 创建自己的 D1 数据库、KV 命名空间和私有 R2 存储桶。
2. 用 `npm run configure` 填入域名和资源 ID。
3. 初始化远端数据库，设置 Access 和 Turnstile，上传自己的 Secrets。
4. 保持 `SALES_OPEN=false` 完成首次部署和身份校验。
5. 配好 Stripe Webhook、库存和真实销售期，通过沙盒测试后再开售。

逐步命令和首次部署步骤见 [部署文档](docs/部署.md)。`npm run deploy` 会先运行生产配置自检。仓库不含自动部署任务，也不会连接原站资源。

## 已包含的功能

- 桌面展示页、移动购买页、订单查询、支付结果、配送指南与隐私页。
- 家庭装 / 礼盒装零售；平安树 / 富贵树认领、PIN 登录和分次预约。
- 服务端重新计价、事务库存、支付创建幂等、签名回调确认付款。
- 折扣券创建、备份下载、限次核销、占用与释放。
- 订单与客户管理、库存调整审计、活动赞助审核、发货、私有发票 PDF。
- 退款核对、固定请求重试、Webhook 结果同步；模拟体验不发真实退款。
- 可选 Telegram 经营通知、快递100轨迹、访客同意后的统计。
- 城市级足迹地图，保留来源和许可；不展示客户详细地址。

这是一套**中文、人民币、苹果零售与果树认领**流程，不是任意品类、多币种商城。四个 SKU 是业务类型；认领权益仍为平安树 8 箱、富贵树 15 箱。更换品类或权益数量需要同步修改文案、服务端和数据库迁移。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run setup` | 一次完成本地数据库和演示配置 |
| `npm run configure` | 交互式填写公开配置 |
| `npm run config:sync` | 同步配置生成文件，不操作数据库 |
| `npm run doctor` | 检查本地配置 |
| `npm run doctor -- --production` | 检查生产资源和必需 Secret 名单 |
| `npm run check` / `npm test` | 类型检查 / 业务测试 |
| `npm run build:production` | 构建并检查静态公开页、私有路径和脚本体积 |
| `npm run scan:public` | 检查待公开文件中的凭证与私有文件 |
| `npm run deploy` | 自检、构建、部署自己的生产环境 |

GitHub Actions 使用 Node 24，执行配置、类型、业务测试、生产构建、公开文件扫描和生产依赖审计。CI 不使用生产密钥。

## 常见问题

**打开首页但下单接口 404？** 先运行 `npm run setup`，然后使用 `npm run dev`。`npm run dev:pages` 只适合页面开发。

**构建提示 Node 版本过低？** 使用 `.nvmrc` 指定的 Node 24，切换后重新 `npm ci`。

**后台在公网打不开？** 正式环境需要 Cloudflare Access JWT 和 `ADMIN_EMAIL` 一致；按部署文档设置，不能用 DEMO_MODE 绕过。

**商品显示售罄？** 远端初始化库存固定为 0，进后台按真实库存调整。本地 `setup` 会填演示库存。

**修改价格没有生效？** 公开静态页需要重新构建；数据库需要单独应用 `scripts/catalog-update.sql`。详见配置参考。

**手机付款默认支付宝，但账号没有开通？** 在购买页选择银行卡；支付方式取决于你自己的 Stripe 账号与地区，仓库不提供收款资质。

## 许可

原创代码及演示 SVG 使用 [MIT](LICENSE)。地图、行政区划和城市数据遵循各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。原运营方的品牌、商标、私人素材与客户数据未包含在本仓库，也不属于本许可证的授权内容。
