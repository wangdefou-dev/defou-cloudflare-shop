// Site settings console (/admin/studio): page content, media library, payment and domain status.
// Separate from the operations admin (/admin) and limited to STUDIO_EMAIL.
import { useEffect, useState } from 'react';
import {
  CreditCard,
  ExternalLink,
  Globe,
  ImageIcon,
  LayoutTemplate,
  Copy,
  Trash2,
  Upload,
  CheckCircle2,
  XCircle,
  Store,
} from 'lucide-react';
import { ErrorBox, request } from './ui';
import { prepareImageUpload } from './image-upload';
import AdminSiteContent from './AdminSiteContent';
import { adminTime } from './AdminOrderDetail';
import { STORE } from '../lib/store-config';
import { money } from '../lib/shared';
import regionAssets from '../lib/region-assets.json';
import '../styles/admin.css';
import '../styles/admin-app.css';

const TABS = [
  ['store', '接单与运费', Store],
  ['content', '网站内容', LayoutTemplate],
  ['media', '媒体库', ImageIcon],
  ['payment', '支付', CreditCard],
  ['site', '域名与站点', Globe],
] as const;

export default function Studio() {
  const [tab, setTab] = useState<string>('store');
  useEffect(() => {
    const fromHash = location.hash.slice(1);
    if (TABS.some(([k]) => k === fromHash)) setTab(fromHash);
  }, []);
  const go = (next: string) => {
    setTab(next);
    history.replaceState(null, '', '#' + next);
  };
  return (
    <div className="admin-app studio-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <strong>{STORE.brand.name}</strong>
          <span>网站设置</span>
        </div>
        <nav className="admin-nav" aria-label="网站设置">
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? 'selected' : ''}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <a href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> 打开网站
          </a>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <h1>{TABS.find(([k]) => k === tab)?.[1]}</h1>
        </header>
        <div className="admin-body">
          {tab === 'store' && <StoreSettings />}
          {tab === 'content' && <AdminSiteContent />}
          {tab === 'media' && <MediaLibrary />}
          {tab === 'payment' && <StatusPage kind="payment" />}
          {tab === 'site' && <StatusPage kind="site" />}
        </div>
      </main>
    </div>
  );
}

const size = (bytes: number) =>
  bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';

function MediaLibrary() {
  const [items, setItems] = useState<any[] | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async (next?: string) => {
    const r = await request(
      '/admin/studio/media' + (next ? '?cursor=' + encodeURIComponent(next) : ''),
    );
    setItems((old) => (next ? [...(old || []), ...r.items] : r.items));
    setCursor(r.cursor);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('file', await prepareImageUpload(file));
        const r = await fetch('/api/admin/studio/upload', { method: 'POST', body: form });
        const v: any = await r.json();
        if (!r.ok) throw Error(v.error);
      }
      setNotice(`已上传 ${files.length} 张图片`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(key: string) {
    if (!confirm('永久删除这张图片？删除后无法恢复。')) return;
    setError('');
    try {
      await request('/admin/studio/media/delete', { key });
      setItems((old) => (old || []).filter((x) => x.key !== key));
      setNotice('已删除');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="media-library">
      <div className="admin-toolbar">
        <p className="admin-note">
          这里是所有上传过的图片（网站配图、商品图、日记、返图等）。在「网站内容」里替换配图时也可以直接上传。
          正在使用的图片不能删除。
        </p>
        <label className="small-button primary">
          <Upload size={14} /> {busy ? '正在上传…' : '上传图片'}
          <input
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => upload(e.currentTarget.files)}
          />
        </label>
      </div>
      <ErrorBox text={error} />
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {!items && !error && <p className="admin-loading">正在读取…</p>}
      {items && !items.length && (
        <div className="admin-empty">
          <ImageIcon size={32} strokeWidth={1.2} />
          <p>还没有上传过图片</p>
        </div>
      )}
      <div className="media-grid">
        {(items || []).map((x) => (
          <figure key={x.key} className="media-card">
            <a href={x.url} target="_blank" rel="noreferrer">
              <img src={x.url} alt="" loading="lazy" />
            </a>
            <figcaption>
              <div className="media-tags">
                {x.uses.length ? (
                  x.uses.map((u: string) => (
                    <span key={u} className="status-tag paid">
                      {u}
                    </span>
                  ))
                ) : (
                  <span className="status-tag expired">未使用</span>
                )}
              </div>
              <small>
                {size(x.size)} · {adminTime(x.uploaded)}
              </small>
              <div className="media-actions">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(location.origin + x.url);
                    setNotice('已复制图片地址');
                  }}
                >
                  <Copy size={13} /> 复制地址
                </button>
                <button
                  type="button"
                  disabled={x.uses.length > 0}
                  title={x.uses.length ? '正在使用，不能删除' : ''}
                  onClick={() => remove(x.key)}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      {cursor && (
        <button type="button" className="small-button" onClick={() => load(cursor)}>
          加载更多
        </button>
      )}
    </div>
  );
}

const Ok = ({ on, yes = '已配置', no = '未配置' }: { on: boolean; yes?: string; no?: string }) => (
  <span className={'status-check ' + (on ? 'on' : 'off')}>
    {on ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {on ? yes : no}
  </span>
);
const Code = ({ children }: { children: string }) => (
  <code className="status-code">{children}</code>
);

// A settings row: name (and optional hint) on the left, current state on the right.
const Row = ({ label, hint, children }: { label: string; hint?: string; children: any }) => (
  <div className="settings-row">
    <div className="settings-label">
      {label}
      {hint && <small>{hint}</small>}
    </div>
    <div className="settings-value">{children}</div>
  </div>
);
const Panel = ({ title, intro, children }: { title: string; intro?: any; children: any }) => (
  <section className="settings-panel">
    <header>
      <h2>{title}</h2>
      {intro && <p>{intro}</p>}
    </header>
    {children}
  </section>
);

function StatusPage({ kind }: { kind: 'payment' | 'site' }) {
  const [s, setS] = useState<any>(null),
    [error, setError] = useState(''),
    [section, setSection] = useState('');
  useEffect(() => {
    request('/admin/studio/status')
      .then(setS)
      .catch((e) => setError(e.message));
  }, []);
  const menu: [string, string][] =
    kind === 'payment'
      ? [
          ['status', '收款状态'],
          ['keys', '密钥与回调'],
          ['howto', '修改方法'],
        ]
      : [
          ['domain', '域名'],
          ['media', '图床'],
          ['access', '登录与安全'],
          ['services', '通知与物流'],
          ['inventory', '全部部署设置'],
          ['howto', '修改方法'],
        ];
  const current = menu.some(([k]) => k === section) ? section : menu[0][0];
  if (!s) return error ? <ErrorBox text={error} /> : <p className="admin-loading">正在读取…</p>;
  const env = 'production';
  const secret = (name: string) => `npx wrangler secret put ${name} --env ${env}`;
  const p = s.payment,
    site = s.site;
  const body = (() => {
    switch (current) {
      case 'status':
        return (
          <Panel title="收款状态" intro="当前环境的收款方式和最近的支付回调。">
            <Row label="支付模式">
              <span className={'status-tag ' + (p.mode === 'live' ? 'paid' : 'pending')}>
                {p.mode === 'live' ? '正式收款' : '测试模式（不会真实扣款）'}
              </span>
            </Row>
            <Row label="销售总开关" hint="日常暂停请用「接单与运费」">
              <Ok on={p.salesOpen} yes="已开售" no="未开售" />
            </Row>
            <Row label="销售季" hint="在「网站内容 → 销售季」修改">
              {p.season.start} 至 {p.season.end}
            </Row>
            <Row label="最近一次支付回调">
              {p.lastWebhook
                ? `${adminTime(p.lastWebhook.created_at)} · ${p.lastWebhook.type}`
                : '还没有收到过'}
            </Row>
            <Row label="近 7 天回调次数">{p.webhooks7d} 次</Row>
          </Panel>
        );
      case 'keys':
        return (
          <Panel
            title="密钥与回调"
            intro="密钥只保存在 Cloudflare 的加密变量里，这里只显示是否已配置，不显示内容。"
          >
            <Row label="Stripe 收款密钥" hint="STRIPE_SECRET_KEY">
              <Ok on={p.secretKey} />
            </Row>
            <Row label="回调签名密钥" hint="STRIPE_WEBHOOK_SECRET">
              <Ok on={p.webhookSecret} />
            </Row>
            <Row label="退款专用密钥" hint="STRIPE_REFUND_SECRET_KEY">
              <Ok on={p.refundKey} no="未配置（后台快捷退款不可用）" />
            </Row>
            <Row label="支付方式配置" hint="STRIPE_PAYMENT_METHOD_CONFIGURATION">
              <Ok on={p.paymentMethodConfiguration} no="未指定（使用 Stripe 默认）" />
            </Row>
            <Row label="回调地址">
              <code className="status-code">{site.publicOrigin + '/api/stripe/webhook'}</code>
            </Row>
          </Panel>
        );
      case 'domain':
        return (
          <Panel title="域名" intro="网站的访问地址和对外状态。">
            <Row label="正式网址">
              <a href={site.publicOrigin} target="_blank" rel="noreferrer">
                {site.publicOrigin}
              </a>
            </Row>
            <Row label="当前环境网址">{site.appOrigin || '—'}</Row>
            <Row label="网站状态">
              <Ok on={!site.offline} yes="正常开放" no="已暂停（停站页）" />
              {site.demo && <span className="status-tag pending">本地演示模式</span>}
              {site.sandboxCheckout && <span className="status-tag pending">测试站</span>}
            </Row>
            <Row label="搜索引擎收录">
              <Ok on={site.searchIndexing} yes="允许收录" no="不收录（非正式环境或已停站）" />
            </Row>
            <Row label="访问统计" hint="在「网站内容 → 搜索与统计」填写">
              <Ok on={site.analytics} />
            </Row>
          </Panel>
        );
      case 'media':
        return (
          <Panel
            title="图床"
            intro="网站上传的图片和发票文件存放在 Cloudflare R2。图片管理在「媒体库」；发票 PDF 只能在经营后台打开。"
          >
            <Row label="存储">
              <Ok on={s.media.bound} yes="已连接" no="未连接" />
            </Row>
            <Row label="已存文件">
              {s.media.objects} 个{s.media.partial && '（只统计了前 1 万个）'}
            </Row>
            <Row label="占用空间">{size(s.media.bytes)}</Row>
          </Panel>
        );
      case 'access':
        return (
          <Panel
            title="登录与安全"
            intro="后台由 Cloudflare Access 登录保护，网站自身再校验管理员名单。"
          >
            <Row label="后台登录保护" hint="Cloudflare Access">
              <Ok on={s.access.configured} />
            </Row>
            <Row label="经营后台管理员" hint="ADMIN_EMAIL">
              {s.access.admins} 人
            </Row>
            <Row label="网站设置管理员" hint="STUDIO_EMAIL">
              {s.access.studio} 人
            </Row>
            <Row label="人机验证" hint="Cloudflare Turnstile">
              <Ok on={s.access.turnstile} />
            </Row>
          </Panel>
        );
      case 'services':
        return (
          <Panel
            title="通知与物流"
            intro="日报时间在「网站内容 → 通知」修改；开关和密钥在部署设置里。"
          >
            <Row label="订单通知" hint="Telegram">
              <Ok on={s.services.notifications && s.services.telegram} yes="已开启" no="未开启" />
            </Row>
            <Row label="物流实时查询" hint="快递100">
              <Ok on={s.services.tracking && s.services.kuaidi100} yes="已开启" no="未开启" />
            </Row>
          </Panel>
        );
      case 'inventory':
        return (
          <Panel
            title="全部部署设置"
            intro="代码读取的每一个部署设置。它们写在 wrangler.jsonc 或加密变量里，网站自己改不了；密钥只显示是否已配置。"
          >
            <table className="settings-table">
              <thead>
                <tr>
                  <th>分组</th>
                  <th>名称</th>
                  <th>用途</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {s.inventory.map((v: any) => (
                  <tr key={v.name}>
                    <td>{v.group}</td>
                    <td>
                      <code>{v.name}</code>
                      {v.kind === 'secret' && <small className="inv-kind">加密</small>}
                    </td>
                    <td>{v.purpose}</td>
                    <td>
                      {v.kind === 'unused' ? (
                        <span className="status-tag expired">
                          {v.configured ? '已设置但未使用' : '未设置'}
                        </span>
                      ) : v.kind === 'fallback' ? (
                        <span className="status-tag">
                          {v.configured ? '旧值，仅作兜底' : '未设置'}
                        </span>
                      ) : v.value ? (
                        <code>{v.value}</code>
                      ) : (
                        <Ok on={v.configured} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        );
      default:
        return kind === 'payment' ? (
          <Panel
            title="修改方法"
            intro="为了安全，支付密钥只能在电脑上用命令写入 Cloudflare，网站本身改不了。"
          >
            <ol className="settings-steps">
              <li>
                <strong>更换收款密钥</strong>在 Stripe 后台创建受限密钥（只开 Checkout Sessions
                写权限），然后运行
                <Code>{secret('STRIPE_SECRET_KEY')}</Code>
              </li>
              <li>
                <strong>更换支付回调</strong>
                Stripe 后台 → 开发者 → Webhooks，地址填
                <Code>{site.publicOrigin + '/api/stripe/webhook'}</Code>，再运行
                <Code>{secret('STRIPE_WEBHOOK_SECRET')}</Code>
              </li>
              <li>
                <strong>切换正式 / 测试、销售总开关</strong>
                修改 <Code>wrangler.jsonc</Code> 中的 <Code>STRIPE_MODE</Code> 和{' '}
                <Code>SALES_OPEN</Code>
                ，然后重新部署。
              </li>
            </ol>
            <p className="settings-foot">详细步骤见 docs/部署指南.md。不要用真实订单做退款测试。</p>
          </Panel>
        ) : (
          <Panel title="修改方法" intro="以下设置需要在电脑上修改部署配置后重新部署。">
            <ol className="settings-steps">
              <li>
                <strong>更换域名</strong>在 Cloudflare 把新域名加入同一账号；修改{' '}
                <Code>wrangler.jsonc</Code> 的 <Code>routes</Code> 和 <Code>APP_ORIGIN</Code>、
                <Code>config/store.json</Code> 的 <Code>brand.siteUrl</Code>
                ，重新部署；同时更新 Stripe 回调地址，以及 Cloudflare Access 保护的路径
                <Code>/admin</Code> 和 <Code>/api/admin</Code>（网站设置也在这两个路径下）。
              </li>
              <li>
                <strong>增减管理员</strong>
                经营后台运行 <Code>{secret('ADMIN_EMAIL')}</Code>，网站设置运行{' '}
                <Code>{secret('STUDIO_EMAIL')}</Code>，多个邮箱用逗号分隔；Cloudflare Access
                策略里也要允许这些邮箱。
              </li>
              <li>
                <strong>临时停站</strong>把 <Code>SITE_OFFLINE</Code> 改为 <Code>true</Code>{' '}
                并重新部署。只想暂停下单，用「接单与运费」。
              </li>
            </ol>
          </Panel>
        );
    }
  })();
  return (
    <div className="settings-view">
      <nav className="sc-tabs" aria-label={kind === 'payment' ? '支付' : '域名与站点'}>
        {menu.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={current === key ? 'selected' : ''}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {body}
    </div>
  );
}

function StoreSettings() {
  // All provinces from the site's region dictionary, names shortened (新疆, 内蒙古…).
  const [provinces, setProvinces] = useState<[string, string][]>([]);
  useEffect(() => {
    fetch(regionAssets.prefix + 'root.json')
      .then((r) => (r.ok ? r.json() : []) as Promise<{ adcode: string; name: string }[]>)
      .then((rows) =>
        setProvinces(
          rows.map((r) => [
            r.adcode,
            r.name.replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|省$|市$/g, ''),
          ]),
        ),
      )
      .catch(() => {});
  }, []);
  const [part, setPart] = useState<'orders' | 'shipping'>('orders');
  const [form, setForm] = useState<any>(null),
    [saved, setSaved] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request('/admin/studio/store')
      .then((v) => {
        const next = {
          sales_paused: !!v.sales_paused,
          announcement: v.announcement || '',
          remote_fee: v.remote_fee,
          remote_provinces: v.remote_provinces || [],
        };
        setForm(next);
        setSaved(next);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!form) return error ? <ErrorBox text={error} /> : <p className="admin-loading">正在读取…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const extra = form.remote_provinces.filter((c: string) => !provinces.some(([p]) => p === c));
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/admin/studio/store', form);
      setSaved(form);
      setNotice('已保存，立即生效');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-view store-settings">
      <nav className="sc-tabs" aria-label="接单与运费">
        {(
          [
            ['orders', '接单与公告'],
            ['shipping', '偏远地区运费'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={part === key ? 'selected' : ''}
            onClick={() => setPart(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="settings-panel settings-form" hidden={part !== 'orders'}>
        <header>
          <h2>接单与公告</h2>
          <p>日常开关，保存后立即生效，不需要重新部署。</p>
        </header>
        <label className="sc-switch">
          <input
            type="checkbox"
            checked={form.sales_paused}
            onChange={(e) => set('sales_paused', e.currentTarget.checked)}
          />
          <span>暂停接单（前台可以浏览，但不能下单）</span>
        </label>
        <label className="sc-field">
          <span>店铺公告（选填，显示在下单页和认领页顶部，200 字内）</span>
          <textarea
            rows={2}
            maxLength={200}
            value={form.announcement}
            placeholder="如：11 月 20 日起暂停发货，12 月 1 日恢复"
            onInput={(e: any) => set('announcement', e.currentTarget.value)}
          />
        </label>
        <p className="admin-note">
          这是日常开关。总开关 SALES_OPEN 和销售季日期决定能否开卖：销售季在「网站内容 →
          销售季」里改。
        </p>
      </section>
      <section className="settings-panel settings-form" hidden={part !== 'shipping'}>
        <header>
          <h2>偏远地区运费</h2>
          <p>收货地址在下面勾选的省份时，每箱加收运费，金额在付款前显示给顾客。</p>
        </header>
        <label className="sc-field">
          <span>每箱加收（元）</span>
          <input
            type="number"
            min="0"
            max="1000"
            step="0.01"
            value={form.remote_fee / 100}
            onInput={(e: any) => set('remote_fee', Math.round(Number(e.currentTarget.value) * 100))}
          />
        </label>
        <div className="sc-field">
          <span>适用省份（当前 ¥{money(form.remote_fee)} / 箱）</span>
          <div className="province-grid">
            {provinces.map(([code, name]) => (
              <label key={code} className="province-check">
                <input
                  type="checkbox"
                  checked={form.remote_provinces.includes(code)}
                  onChange={(e) =>
                    set(
                      'remote_provinces',
                      e.currentTarget.checked
                        ? [...form.remote_provinces, code]
                        : form.remote_provinces.filter((c: string) => c !== code),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
          {provinces.length > 0 && extra.length > 0 && (
            <small>另有 {extra.length} 个未识别的地区设置，保存时会保留</small>
          )}
        </div>
      </section>
      <ErrorBox text={error} />
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      <div className={'sc-savebar' + (dirty ? ' dirty' : '')}>
        <span>{dirty ? '有未保存的修改' : '保存后立即生效'}</span>
        <button
          type="button"
          className="small-button"
          disabled={!dirty || busy}
          onClick={() => setForm(saved)}
        >
          放弃修改
        </button>
        <button
          type="button"
          className="small-button primary"
          disabled={!dirty || busy}
          onClick={save}
        >
          {busy ? '正在保存…' : '保存'}
        </button>
      </div>
    </div>
  );
}
