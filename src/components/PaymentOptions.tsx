import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import { browserPaymentEnvironment, publicPaymentLink } from '../lib/payment-experience';

export function usePaymentEnvironment() {
  const [environment, setEnvironment] = useState({ wechat: false, mobile: false });
  useEffect(() => setEnvironment(browserPaymentEnvironment()), []);
  return environment;
}

export function PaymentOptions({
  value,
  onChange,
}: {
  value: 'alipay' | 'card';
  onChange: (value: 'alipay' | 'card') => void;
}) {
  const name = useId();
  return (
    <fieldset className="wallet-options">
      <legend>付款方式</legend>
      <div className="wallet-options-grid">
        <label className={value === 'alipay' ? 'selected' : ''}>
          <input
            type="radio"
            name={name}
            value="alipay"
            checked={value === 'alipay'}
            onChange={() => onChange('alipay')}
          />
          <span className="alipay-mark" aria-hidden="true">
            支
          </span>
          <span>
            <strong>支付宝</strong>
            <small>跳转付款</small>
          </span>
        </label>
        <label className={value === 'card' ? 'selected' : ''}>
          <input
            type="radio"
            name={name}
            value="card"
            checked={value === 'card'}
            onChange={() => onChange('card')}
          />
          <CreditCard size={23} aria-hidden="true" />
          <span>
            <strong>银行卡</strong>
            <small>备用方式</small>
          </span>
        </label>
      </div>
      <p>支付宝会前往授权页面；已安装 App 时，可按页面提示打开付款。</p>
    </fieldset>
  );
}

export function WeChatBrowserNotice({
  onOpen,
  existingOrder = false,
}: {
  onOpen: () => void;
  existingOrder?: boolean;
}) {
  return (
    <div className="browser-payment-notice" role="note">
      <ArrowUpRight size={22} aria-hidden="true" />
      <div>
        <strong>请先在浏览器中打开，再用支付宝付款</strong>
        <p>
          {existingOrder
            ? '点击右上角「···」→「在浏览器打开」，用手机号和订单号继续原订单。'
            : '点击微信右上角「···」→「在浏览器打开」，再填写下单信息。'}
        </p>
        <button className="text-button" type="button" onClick={onOpen}>
          查看打开方式
        </button>
      </div>
    </div>
  );
}

export function PaymentGuide({
  url,
  order,
  onClose,
}: {
  url?: string;
  order?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [link, setLink] = useState('');
  useEffect(() => {
    setLink(
      url ||
        (order
          ? location.origin + '/pay/result?order=' + encodeURIComponent(order)
          : publicPaymentLink(location.href)),
    );
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [url, order, onClose]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="modal-backdrop">
      <div
        className="modal payment-browser-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <ArrowUpRight size={36} aria-hidden="true" />
        <h2 id="guide-title">用浏览器打开，继续付款</h2>
        <p>微信内可能拦截支付宝跳转，请先切换到系统浏览器。</p>
        <ol>
          <li>点右上角「···」</li>
          <li>选择「在浏览器打开」</li>
          <li>在 Safari 或手机浏览器中用支付宝付款</li>
        </ol>
        {order ? (
          <p className="code-block">订单号：{order}</p>
        ) : (
          <p>请先切换浏览器，再填写收货信息；当前尚未创建订单。</p>
        )}
        {order && <p>订单已创建，请继续支付原订单，避免重复下单。</p>}
        <button type="button" className="button primary" disabled={!link} onClick={copy}>
          {copied ? '链接已复制' : '复制链接到浏览器打开'}
        </button>
        <p className="payment-copy-status" role="status">
          {copied
            ? '粘贴到 Safari 或手机浏览器的地址栏打开'
            : copyError
              ? '复制失败，请长按下方链接复制'
              : ''}
        </p>
        {copyError && (
          <input
            aria-label="可复制的付款链接"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </div>
    </div>
  );
}
