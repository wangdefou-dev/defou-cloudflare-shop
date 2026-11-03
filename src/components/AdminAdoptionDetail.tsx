import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button, ErrorBox, Field, request } from './ui';
import { adminTime } from './AdminOrderDetail';
import { statusNames } from '../lib/shared';
import type { AdoptionDetail } from '../lib/admin-people';

export default function AdminAdoptionDetail({
  id,
  onClose,
  onUpdated,
  onOrder,
}: {
  id: number;
  onClose: () => void;
  onUpdated: () => Promise<unknown>;
  onOrder: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(true),
    saving = useRef(false);
  const [data, setData] = useState<AdoptionDetail | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [name, setName] = useState('');
  const [pin, setPin] = useState(''),
    [confirm, setConfirm] = useState(''),
    [reason, setReason] = useState(''),
    [verified, setVerified] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const d = await request('/admin/adoption-detail', { id });
      if (active.current) {
        setData(d);
        setName(d.plate_name);
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void load();
    return () => {
      active.current = false;
      document.body.style.overflow = overflow;
    };
  }, [id]);
  async function save(e: React.SyntheticEvent, kind: 'name' | 'pin') {
    e.preventDefault();
    if (saving.current || !data) return;
    if (kind === 'pin' && pin !== confirm) {
      setError('两次 PIN 不一致');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(
        kind === 'pin' ? '/admin/adoption-pin' : '/admin/adoption-name',
        kind === 'pin'
          ? { id, version: data.pin_version, pin, confirm_pin: confirm, reason, verified }
          : { id, plate_name: name },
      );
      if (active.current) {
        setNotice(
          kind === 'pin'
            ? 'PIN 已重置，原果树登录会话已失效。请由你将新 PIN 告知客户。'
            : '树牌昵称已保存',
        );
        setVerified(false);
        setReason('');
        await load();
      }
      await onUpdated();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      saving.current = false;
      if (active.current) {
        setBusy(false);
        setPin('');
        setConfirm('');
      }
    }
  }
  const enabled = data && ['paid', 'shipped'].includes(data.status);
  return (
    <dialog
      ref={dialog}
      className="admin-order-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) onClose();
      }}
    >
      <header className="admin-detail-heading">
        <div>
          <h2>认领详情与 PIN 管理</h2>
          <p>{data?.adopt_code || '加载中…'}</p>
        </div>
        <div>
          <button
            className="small-button"
            aria-label="刷新认领详情"
            disabled={busy || loading}
            onClick={() => {
              setError('');
              void load();
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="small-button"
            aria-label="关闭认领详情"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className="admin-detail-body">
        <ErrorBox text={error} />
        {notice && (
          <p className="alert success" role="status">
            {notice}
          </p>
        )}
        {loading && <p role="status">正在加载认领…</p>}
        {data && (
          <>
            <section className="admin-detail-section">
              <h3>
                {data.tier === 888 ? '平安树' : '富贵树'} ·{' '}
                {statusNames[data.status] || data.status}
              </h3>
              <dl className="admin-detail-grid">
                <div>
                  <dt>认领码</dt>
                  <dd>{data.adopt_code}</dd>
                </div>
                <div>
                  <dt>下单手机号</dt>
                  <dd>{data.phone}</dd>
                </div>
                <div>
                  <dt>树牌昵称</dt>
                  <dd>{data.plate_name}</dd>
                </div>
                <div>
                  <dt>本季权益</dt>
                  <dd>
                    共 {data.total_boxes} 箱，已预约 {data.used_boxes} 箱，剩余{' '}
                    {data.total_boxes - data.used_boxes} 箱
                  </dd>
                </div>
                <div>
                  <dt>预约截止</dt>
                  <dd>{data.expires_at}</dd>
                </div>
                <div>
                  <dt>关联订单</dt>
                  <dd>{data.order_no}</dd>
                </div>
              </dl>
              <button
                className="small-button"
                disabled={busy}
                onClick={() => onOrder(data.order_id)}
              >
                查看订单、预约与收货详情
              </button>
              <details className="admin-edit-details">
                <summary>修改树牌昵称</summary>
                <form onSubmit={(e) => save(e, 'name')}>
                  <Field label="树牌昵称">
                    <input
                      required
                      maxLength={12}
                      value={name}
                      onChange={(e) => setName(e.currentTarget.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    busy={busy}
                    disabled={!name.trim() || name === data.plate_name}
                  >
                    保存昵称
                  </Button>
                </form>
              </details>
            </section>
            <section className="admin-detail-section">
              <h3>认领 PIN</h3>
              <dl className="admin-detail-grid">
                <div>
                  <dt>设置状态</dt>
                  <dd>{data.has_pin ? '已设置' : '未设置'}</dd>
                </div>
                <div>
                  <dt>最后重置</dt>
                  <dd>{data.pin_updated_at ? adminTime(data.pin_updated_at) : '暂无重置记录'}</dd>
                </div>
                <div>
                  <dt>当前有效登录会话</dt>
                  <dd>{data.active_sessions} 个</dd>
                </div>
                <div>
                  <dt>重置次数</dt>
                  <dd>{data.pin_version} 次</dd>
                </div>
              </dl>
              <p className="fine-print">
                原 PIN 只保存不可逆哈希，无法查回明文。客户遗忘时可设置新 PIN；保存后旧 PIN
                和当前登录会话立即失效，不改变已购箱数、收货预约或支付记录。
              </p>
              {enabled ? (
                <details className="admin-edit-details">
                  <summary>重置认领 PIN</summary>
                  <form className="admin-pin-form" onSubmit={(e) => save(e, 'pin')}>
                    <div className="form-grid">
                      <Field label="新 PIN（6 位数字）">
                        <input
                          type="password"
                          autoComplete="new-password"
                          inputMode="numeric"
                          required
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={pin}
                          onChange={(e) => setPin(e.currentTarget.value)}
                        />
                      </Field>
                      <Field label="再次输入新 PIN">
                        <input
                          type="password"
                          autoComplete="new-password"
                          inputMode="numeric"
                          required
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={confirm}
                          onChange={(e) => setConfirm(e.currentTarget.value)}
                        />
                      </Field>
                    </div>
                    <Field label="重置原因">
                      <textarea
                        required
                        minLength={2}
                        maxLength={160}
                        value={reason}
                        onChange={(e) => setReason(e.currentTarget.value)}
                        placeholder="例如：客户忘记 PIN，已核对订单与身份；不要填 PIN 或手机号"
                      />
                    </Field>
                    <label className="check-row">
                      <input
                        required
                        type="checkbox"
                        checked={verified}
                        onChange={(e) => setVerified(e.currentTarget.checked)}
                      />
                      我已核对客户身份，确认重置并使其原登录会话失效
                    </label>
                    <Button
                      type="submit"
                      busy={busy}
                      disabled={
                        !verified || pin.length !== 6 || confirm.length !== 6 || !reason.trim()
                      }
                    >
                      确认重置 PIN
                    </Button>
                  </form>
                </details>
              ) : (
                <p className="alert">这份认领已退款或失效，不能重置 PIN</p>
              )}
            </section>
            <section className="admin-detail-section">
              <h3>最近 PIN 重置记录</h3>
              {!data.resets.length && <p className="fine-print">暂无重置记录</p>}
              {data.resets.map((r) => (
                <article className="admin-reset-history" key={r.id}>
                  <strong>
                    第 {r.expected_version + 1} 次重置 · {adminTime(r.created_at)}
                  </strong>
                  <p>{r.reason}</p>
                  <small>操作人：{r.actor}</small>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}
