import site from '../../config/site.json';
import { regionChildren } from '../lib/region-data';
import { checkoutRequest, rememberCheckoutOrder, finishCheckoutIntent } from './checkout-client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { LoaderCircle, Minus, Plus, AlertCircle } from 'lucide-react';
import { readPublicData } from '../lib/public-data';
export { PaymentGuide } from './PaymentOptions';
export async function request(path: string, body?: unknown): Promise<any> {
  const r = await fetch(
    '/api' + path,
    body !== undefined
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const v: any = await r.json();
  // Read-only quotes and tracking do not consume a nearby form's Turnstile token.
  if (
    body !== undefined &&
    !['/coupons/quote', '/order/tracking', '/tree/tracking', '/admin/shipment-tracking'].includes(
      path,
    )
  )
    window.dispatchEvent(new Event('turnstile-reset'));
  if (!r.ok)
    throw Object.assign(Error(v.error || '暂时无法处理，请稍后重试'), {
      status: r.status,
      code: v.code,
      request_id: v.request_id,
    });
  return v;
}
export async function placeOrder(body: Record<string, unknown> & { phone: string }) {
  let order: any;
  try {
    order = await request('/checkout', await checkoutRequest(body));
  } catch (e) {
    if ((e as { code?: string }).code === 'checkout_closed') finishCheckoutIntent();
    throw e;
  }
  rememberCheckoutOrder(order.order_no);
  // Private browsing or storage restrictions must not strand an already-created checkout.
  try {
    sessionStorage.setItem(
      'order:' + order.order_no,
      JSON.stringify({ phone: body.phone, view_token: order.view_token }),
    );
  } catch {
    /* Order number and phone remain available for lookup. */
  }
  return order;
}
export function useConfig() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    readPublicData('/config', request)
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return { data, error };
}
export function ErrorBox({ text }: { text: string }) {
  return text ? (
    <p className="alert error" role="alert">
      <AlertCircle size={17} />
      {text}
    </p>
  ) : null;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Button({
  children,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className="button primary" {...props} disabled={busy || props.disabled}>
      {busy ? <LoaderCircle size={18} className="spin" /> : null}
      {children}
    </button>
  );
}
export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div className="eyebrow">{eyebrow}</div>
      <h1>
        {title
          .trim()
          .replace(/[。．.]+$/u, '')
          .split('，')
          .map((phrase, index, parts) => (
            <span className="title-phrase" key={index}>
              {phrase}
              {index < parts.length - 1 ? '，' : ''}
            </span>
          ))}
      </h1>
      {children && <p>{children}</p>}
    </div>
  );
}
export const emptyAddress = {
  recipient: '',
  phone: '',
  province_code: '',
  city_code: '',
  district_code: '',
  province: '',
  city: '',
  district: '',
  address: '',
  card_message: '',
  sender: '',
};
export function AddressForm({
  value,
  onChange,
}: {
  value: typeof emptyAddress;
  onChange: (v: typeof emptyAddress) => void;
}) {
  const [provinces, setP] = useState<any[]>([]),
    [cities, setC] = useState<any[]>([]),
    [districts, setD] = useState<any[]>([]),
    [err, setErr] = useState('');
  useEffect(() => {
    readPublicData('/regions', () => regionChildren())
      .then(setP)
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    let current = true;
    setC([]);
    setD([]);
    setErr('');
    if (value.province_code)
      regionChildren(value.province_code)
        .then((rows) => {
          if (current) setC(rows);
        })
        .catch((e) => {
          if (current) setErr(e.message);
        });
    return () => {
      current = false;
    };
  }, [value.province_code]);
  useEffect(() => {
    let current = true;
    setD([]);
    setErr('');
    if (value.city_code)
      regionChildren(value.city_code)
        .then((rows) => {
          if (current) setD(rows);
        })
        .catch((e) => {
          if (current) setErr(e.message);
        });
    return () => {
      current = false;
    };
  }, [value.city_code]);
  const update = (key: string, v: string) => onChange({ ...value, [key]: v });
  return (
    <>
      <div className="form-grid">
        <Field label="收件人">
          <input
            name="recipient"
            autoComplete="shipping name"
            value={value.recipient}
            onChange={(e) => update('recipient', e.target.value)}
            maxLength={30}
            placeholder="收件人的名字"
            required
          />
        </Field>
        <Field label="收件手机号">
          <input
            name="phone"
            type="tel"
            autoComplete="shipping tel"
            inputMode="tel"
            value={value.phone}
            pattern="1[3-9][0-9]{9}"
            maxLength={11}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="用于快递联系"
            required
          />
        </Field>
      </div>
      <div className="field">
        <span>所在地区</span>
        <div className="region-fields" role="group" aria-label="省市区">
          <select
            aria-label="省份"
            name="province"
            autoComplete="shipping address-level1"
            value={value.province_code}
            required
            onChange={(e) => {
              const p = provinces.find((p) => p.adcode === e.target.value);
              onChange({
                ...value,
                province_code: e.target.value,
                province: p?.name || '',
                city_code: '',
                city: '',
                district_code: '',
                district: '',
              });
            }}
          >
            <option value="">选择省份</option>
            {provinces.map((p) => (
              <option key={p.adcode} value={p.adcode}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="城市"
            name="city"
            autoComplete="shipping address-level2"
            required
            disabled={!value.province_code}
            value={value.city_code}
            onChange={(e) =>
              onChange({
                ...value,
                city_code: e.target.value,
                city: cities.find((c) => c.adcode === e.target.value)?.name || '',
                district_code: '',
                district: '',
              })
            }
          >
            <option value="">选择城市</option>
            {cities.map((c) => (
              <option key={c.adcode} value={c.adcode}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="区县"
            name="district"
            autoComplete="shipping address-level3"
            required
            disabled={!value.city_code}
            value={value.district_code}
            onChange={(e) =>
              onChange({
                ...value,
                district_code: e.target.value,
                district: districts.find((d) => d.adcode === e.target.value)?.name || '',
              })
            }
          >
            <option value="">选择区县</option>
            {districts.map((d) => (
              <option key={d.adcode} value={d.adcode}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field label="详细地址">
        <input
          autoComplete="street-address"
          name="street-address"
          value={value.address}
          onChange={(e) => update('address', e.target.value)}
          minLength={5}
          maxLength={200}
          placeholder="街道、门牌号，请勿重复填写省市区"
          required
        />
      </Field>
      <ErrorBox text={err} />
    </>
  );
}
export const emptyInvoice = { type: 'none', title: '', tax_no: '', email: '' };
export function InvoiceForm({
  value,
  onChange,
}: {
  value: typeof emptyInvoice;
  onChange: (v: typeof emptyInvoice) => void;
}) {
  return (
    <>
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.type !== 'none'}
          onChange={(e) => onChange({ ...value, type: e.target.checked ? 'personal' : 'none' })}
        />
        <span>需要电子普通发票</span>
      </label>
      {value.type !== 'none' && (
        <div className="inset-form">
          <div className="form-grid">
            <Field label="发票类型">
              <select
                value={value.type}
                onChange={(e) => onChange({ ...value, type: e.target.value })}
              >
                <option value="personal">个人</option>
                <option value="company">企业</option>
              </select>
            </Field>
            <Field label="发票抬头">
              <input
                required
                value={value.title}
                onChange={(e) => onChange({ ...value, title: e.target.value })}
                maxLength={100}
              />
            </Field>
          </div>
          {value.type === 'company' && (
            <Field label="企业税号">
              <input
                required
                value={value.tax_no}
                onChange={(e) => onChange({ ...value, tax_no: e.target.value.toUpperCase() })}
                pattern="[A-Za-z0-9]{15,20}"
              />
            </Field>
          )}
          <Field label="接收邮箱">
            <input
              type="email"
              required
              value={value.email}
              onChange={(e) => onChange({ ...value, email: e.target.value })}
            />
          </Field>
          <small>由 {site.publisher} 按实际资质开具，人工处理后发送到邮箱。</small>
        </div>
      )}
    </>
  );
}
declare global {
  interface Window {
    turnstile: any;
  }
}
export function Turnstile({
  demo = false,
  siteKey,
  onToken,
}: {
  demo?: boolean;
  siteKey?: string;
  onToken: (t: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    cb = useRef(onToken);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  cb.current = onToken;
  const localDemo = demo && typeof location !== 'undefined' && ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  useEffect(() => {
    if (localDemo) { cb.current('local-demo'); return; }
    if (!siteKey) return;
    setStatus('loading');
    let widget: any,
      disposed = false;
    const failed = () => {
      if (disposed) return;
      setStatus('failed');
      cb.current('');
    };
    const render = () => {
      if (disposed || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: 'light',
        size: ref.current.clientWidth < 300 ? 'compact' : 'flexible',
        callback: (t: string) => {
          setStatus('done');
          cb.current(t);
        },
        'expired-callback': () => {
          setStatus('expired');
          cb.current('');
        },
        'error-callback': failed,
        'timeout-callback': failed,
      });
    };
    let timer: any;
    if (window.turnstile) render();
    else {
      if (!document.getElementById('turnstile-script')) {
        const script = document.createElement('script');
        script.id = 'turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.addEventListener('error', failed, { once: true });
        document.head.appendChild(script);
      }
      timer = setInterval(() => {
        if (window.turnstile) {
          clearInterval(timer);
          render();
        }
      }, 200);
    }
    const timeout = setTimeout(() => {
      if (!window.turnstile) {
        clearInterval(timer);
        failed();
      }
    }, 15000);
    const reset = () => {
      if (widget !== undefined) {
        window.turnstile?.reset(widget);
        setStatus('loading');
        cb.current('');
      }
    };
    window.addEventListener('turnstile-reset', reset);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(timeout);
      window.removeEventListener('turnstile-reset', reset);
      if (widget !== undefined) window.turnstile?.remove(widget);
    };
  }, [siteKey, attempt, localDemo]);
  if (localDemo) return <p className="summary-note">本地演示 · 不会真实扣款</p>;
  return (
    <div className="challenge-wrap">
      <div className="challenge" ref={ref} />
      {status !== 'done' && (
        <p className="challenge-status" role="status">
          {!siteKey
            ? '付款验证暂不可用，请稍后重试'
            : status === 'failed'
              ? '安全验证加载失败，请检查网络后重试'
              : status === 'expired'
                ? '验证已过期，请重新验证'
                : '正在进行付款前的安全验证…'}
        </p>
      )}
      {siteKey && ['failed', 'expired'].includes(status) && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            if (!window.turnstile) document.getElementById('turnstile-script')?.remove();
            setAttempt((value) => value + 1);
          }}
        >
          重新验证
        </button>
      )}
    </div>
  );
}
export function Quantity({
  value,
  onChange,
  max = 20,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  return (
    <div className="quantity">
      <button
        aria-label="减少箱数"
        type="button"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={15} />
      </button>
      <span>{value}</span>
      <button
        aria-label="增加箱数"
        type="button"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
