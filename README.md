# 得否开源商城

一套跑在 Cloudflare Workers 上的独立商店。版式来自真实运营的苹果商店，自带一个开箱即用的「太行深处」苹果店示例；卖茶叶、蜂蜜、核桃、手作，只需在后台换掉文字、图片和商品。

- **网站设置**（`/admin/studio`）：页面文案、配图、常见问题、销售季、经营规则、功能开关，用表单修改，保存后 10 秒内生效，不用改代码、不用重新部署。
- **经营后台**（`/admin`）：订单、发货、商品、库存、优惠券、客户、发票、坏果理赔、退款。
- **支付**：Stripe Checkout（银行卡、支付宝等），只信任签名回调，金额由服务端重新计算。
- **可选功能**：果树认领、活动赞助、配送足迹地图、日记，在网站设置里一键开关。
- **安全**：后台由 Cloudflare Access 登录保护，Worker 再独立校验身份；顾客信息脱敏展示，关键操作写审计日志。

## 技术栈

Astro 7 + Preact、Cloudflare Workers、D1（数据库）、KV、R2（图片存储）、Turnstile（人机验证）、Cloudflare Access、Stripe Checkout。

## 本地试用

需要 Node.js 24。

```bash
npm install
cp .dev.vars.example .dev.vars   # 默认开启本地演示模式
npm run db:local                 # 建本地数据库
npm run db:seed                  # 写入示例商品
npm run db:demo                  # 行政区划与演示库存
npm run build && npm run preview
```

打开：

- 店铺 http://127.0.0.1:4321
- 经营后台 http://127.0.0.1:4321/admin
- 网站设置 http://127.0.0.1:4321/admin/studio

演示模式只在本机生效：后台不用登录，付款是模拟的。

想看看换成别的店的样子，可以用自带的茶叶示例：

```bash
STORE_CONFIG=config/examples/tea.json npm run build && npm run preview
```

## 部署到自己的域名

按 [docs/部署指南.md](docs/部署指南.md) 一步步来：创建 Cloudflare 资源、配置后台登录、接入 Stripe、部署。

## 改成你自己的店

- 文字、配图、规则：上线后在「网站设置」里改，见 [docs/网站设置.md](docs/网站设置.md)。
- 商品名称、价格、规格、商品图：在「经营后台 → 商品」里改，见 [docs/后台编辑商品.md](docs/后台编辑商品.md)。
- 新店的初始内容、换版式和配色：见 [docs/开源定制.md](docs/开源定制.md)。

## 常用命令

```bash
npm run check          # 类型检查
npm test               # 测试
npm run config:check   # 检查 config/store.json
npm run deploy         # 构建并部署到 production 环境
npm run verify:pages -- https://你的域名 --production   # 上线后检查公开页面
```

## 许可

代码以 [MIT](LICENSE) 许可发布。地图数据与示例图片的来源和许可见 [docs/第三方许可.md](docs/第三方许可.md)。

网站页脚默认显示一行「基于得否开源商城」，可以在「网站设置 → 网站内容 → 品牌与联系」里关闭。

由 [得否科技](https://github.com/wangdefou-dev) 开发维护。
