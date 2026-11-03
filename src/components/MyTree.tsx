import site from '../../config/site.json';
import { useEffect, useState } from 'react';
import { TreeDeciduous, CalendarDays, ArrowUpRight } from 'lucide-react';
import {
  AddressForm,
  Button,
  emptyAddress,
  ErrorBox,
  Field,
  PageIntro,
  Quantity,
  request,
  Turnstile,
  useConfig,
} from './ui';
import { chinaDate, money, shippingFee, statusNames } from '../lib/shared';
import {
  PaymentGuide,
  PaymentOptions,
  usePaymentEnvironment,
  WeChatBrowserNotice,
} from './PaymentOptions';
import { browserPaymentEnvironment } from '../lib/payment-experience';
import ShipmentTracking from './ShipmentTracking';
export default function MyTree() {
  const paymentEnvironment = usePaymentEnvironment();
  const [paymentMethod, setPaymentMethod] = useState<'alipay' | 'card'>('alipay');
  const [guide, setGuide] = useState(false);
  const { data: c } = useConfig(),
    [tree, setTree] = useState<any>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [pin, setPin] = useState(''),
    [token, setToken] = useState(''),
    [address, setAddress] = useState(emptyAddress),
    [qty, setQty] = useState(1),
    [date, setDate] = useState(chinaDate(2)),
    [success, setSuccess] = useState(''),
    [editing, setEditing] = useState<any>(null);
  const refresh = () => request('/tree/me').then(setTree);
  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  async function login(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('/tree/login', { phone, code, pin, turnstile: token });
      setPin('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function book(e: React.SyntheticEvent) {
    e.preventDefault();
    const fee =
      c &&
      shippingFee(address.province_code, qty, c.settings.remote_provinces, c.settings.remote_fee);
    if (fee > 0 && browserPaymentEnvironment().wechat) {
      setGuide(true);
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const v = await request('/tree/book', {
        qty,
        address,
        expected_date: date,
        payment_method: browserPaymentEnvironment().mobile ? paymentMethod : 'auto',
      });
      if (v.payment_required) {
        try {
          sessionStorage.setItem(
            'order:' + v.order_no,
            JSON.stringify({ phone, view_token: v.view_token }),
          );
        } catch {
          /* Continue to the already-created payment even if storage is blocked. */
        }
        location.href = v.url;
      } else {
        setSuccess('预约好了。这份心意，会按约定出发。');
        setAddress(emptyAddress);
        setQty(1);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    setError('');
    try {
      await request('/tree/cancel', { id });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function edit(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await request('/tree/edit', {
        id: editing.id,
        expected_date: editing.expected_date,
        card_message: editing.card_message,
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-wrap">
      {guide && <PaymentGuide onClose={() => setGuide(false)} />}
      <PageIntro
        eyebrow="MY LITTLE ORCHARD"
        title={tree ? `${tree.plate_name}，正在等你` : '看看，你的树'}
      >
        {tree
          ? '一棵真实的树，和这一季可以慢慢分送的心意。'
          : '输入认领时的手机号、认领码和 PIN，就能回到你的小果园。'}
      </PageIntro>
      {checking ? (
        <p className="loading-text">正在走进果园…</p>
      ) : !tree ? (
        <div className="narrow-panel">
          <div className="login-icon">
            <TreeDeciduous size={58} strokeWidth={1} />
          </div>
          <form onSubmit={login}>
            <Field label="认领人手机号">
              <input
                required
                inputMode="tel"
                maxLength={11}
                pattern="1[3-9][0-9]{9}"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </Field>
            <Field label="认领码">
              <input
                required
                placeholder="例如 PA-0023"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="6 位 PIN">
              <input
                required
                inputMode="numeric"
                type="password"
                pattern="[0-9]{6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Turnstile demo={c?.demo} siteKey={c?.turnstile_site_key} onToken={setToken} />
            <ErrorBox text={error} />
            <Button busy={busy} disabled={!c || !token}>
              回到我的果园 <ArrowUpRight size={17} />
            </Button>
            <p className="fine-print centered">
              还没有自己的树？<a href="/tree">去认领一棵 ↗</a>
            </p>
          </form>
        </div>
      ) : (
        <>
          <div className="deadline-banner">
            <CalendarDays size={20} />
            <span>
              请在 <strong>{site.season.end} 前</strong> 预约全部箱数
            </span>
            <button
              className="text-button"
              onClick={async () => {
                await request('/tree/logout', {});
                setTree(null);
              }}
            >
              退出登录
            </button>
          </div>
          <div className="tree-dashboard">
            <div className="tree-identity">
              {JSON.parse(tree.tree_photo_urls).length ? (
                JSON.parse(tree.tree_photo_urls).map((src: string) => (
                  <img src={src} alt="你的专属苹安树" key={src} />
                ))
              ) : (
                <div className="tree-placeholder">
                  <TreeDeciduous size={140} strokeWidth={0.7} />
                  <span>
                    正在为你的树挂牌拍照
                    <br />
                    认领后 3 天内上传
                  </span>
                </div>
              )}
              <div>
                <span className="eyebrow">{tree.adopt_code}</span>
                <h2>
                  {tree.tier === 888 ? '平安树' : '富贵树'} · {tree.plate_name}
                </h2>
                <p>
                  本季共 {tree.total_boxes} 箱 · 已预约 {tree.used_boxes} 箱
                </p>
                <div className="progress-track">
                  <i style={{ width: (tree.used_boxes / tree.total_boxes) * 100 + '%' }} />
                </div>
                <strong className="remaining-boxes">
                  {tree.total_boxes - tree.used_boxes}
                  <small>箱待预约</small>
                </strong>
              </div>
            </div>
            <section className="form-panel">
              <h2>预约下一份心意</h2>
              {tree.used_boxes >= tree.total_boxes ? (
                <p className="alert success">这一季的心意都安排好啦。</p>
              ) : (
                <form onSubmit={book}>
                  <div className="qty-row">
                    <span>这次寄几箱？</span>
                    <Quantity
                      value={qty}
                      onChange={setQty}
                      max={tree.total_boxes - tree.used_boxes}
                    />
                  </div>
                  <AddressForm value={address} onChange={setAddress} />
                  <div className="form-grid">
                    <Field label="期望发货日期">
                      <input
                        type="date"
                        min={chinaDate(2)}
                        max={site.season.end}
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                    <Field label="卡片寄语（最多 60 字）">
                      <input
                        maxLength={60}
                        value={address.card_message}
                        onChange={(e) => setAddress({ ...address, card_message: e.target.value })}
                        placeholder="给收到苹果的人，一点温暖"
                      />
                    </Field>
                  </div>
                  {c &&
                    shippingFee(
                      address.province_code,
                      qty,
                      c.settings.remote_provinces,
                      c.settings.remote_fee,
                    ) > 0 && (
                      <div>
                        <p className="alert">
                          偏远地区运费 ¥
                          {money(
                            shippingFee(
                              address.province_code,
                              qty,
                              c.settings.remote_provinces,
                              c.settings.remote_fee,
                            ),
                          )}
                          ，支付成功后预约生效。
                        </p>
                        {paymentEnvironment.mobile && (
                          <PaymentOptions value={paymentMethod} onChange={setPaymentMethod} />
                        )}
                        {paymentEnvironment.wechat && (
                          <WeChatBrowserNotice onOpen={() => setGuide(true)} />
                        )}
                      </div>
                    )}
                  <ErrorBox text={error} />
                  {success && <p className="alert success">{success}</p>}
                  <Button busy={busy} disabled={chinaDate(2) > site.season.end}>
                    确认预约 <ArrowUpRight size={17} />
                  </Button>
                </form>
              )}
            </section>
          </div>
          <section className="form-panel">
            <div className="section-heading">
              <h2>心意的出发记录</h2>
              <small>发货前可修改日期、寄语；更换地址可取消后重约。</small>
            </div>
            {tree.shipments.length ? (
              tree.shipments.map((s: any) => (
                <div className="shipment-card" key={s.id}>
                  <div>
                    <span className={'status-tag ' + s.status}>{statusNames[s.status]}</span>
                    <strong>
                      {s.qty} 箱 → {s.region_label}
                    </strong>
                    <p>
                      {s.recipient} · {s.phone} · {s.address}
                    </p>
                    <p>
                      期望日期：{s.expected_date}
                      {s.card_message && ' · 寄语：' + s.card_message}
                    </p>
                    <ShipmentTracking shipment={s} context="tree" />
                  </div>
                  <div className="row-actions">
                    {s.status === 'reserved' && (
                      <button type="button" onClick={() => setEditing({ ...s })}>
                        修改
                      </button>
                    )}
                    {['reserved', 'awaiting_payment'].includes(s.status) && (
                      <button type="button" onClick={() => cancel(s.id)}>
                        取消预约
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-inline">还没有预约记录。第一份心意想寄给谁？</p>
            )}
          </section>
          {editing && (
            <div className="modal-backdrop">
              <form className="modal" onSubmit={edit}>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="关闭"
                  onClick={() => setEditing(null)}
                >
                  ×
                </button>
                <h2>修改预约</h2>
                <Field label="期望发货日期">
                  <input
                    required
                    type="date"
                    min={chinaDate(2)}
                    max={site.season.end}
                    value={editing.expected_date}
                    onChange={(e) => setEditing({ ...editing, expected_date: e.target.value })}
                  />
                </Field>
                <Field label="卡片寄语">
                  <textarea
                    value={editing.card_message}
                    maxLength={60}
                    onChange={(e) => setEditing({ ...editing, card_message: e.target.value })}
                  />
                </Field>
                <ErrorBox text={error} />
                <Button busy={busy}>保存修改</Button>
              </form>
            </div>
          )}
          <p className="fine-print centered">
            未预约箱数将于 销售季结束后寄往最近一次收件地址；无历史地址的由运营联系确认。
          </p>
        </>
      )}
    </div>
  );
}
