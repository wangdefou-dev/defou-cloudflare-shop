import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Copy, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  CARRIERS,
  carrierQueryLabel,
  resolveCarrier,
  type TrackingSnapshot,
} from '../lib/shipping';
import { request } from './ui';
import '../styles/shipment-tracking.css';

type ShipmentReference = {
  id: string;
  carrier?: string | null;
  tracking_no: string | null;
  status: string;
  shipped_at?: string | null;
};
type TrackingContext = 'order' | 'tree' | 'admin';

function displayTime(value: string | null) {
  if (!value) return '';
  // Carrier timestamps without an offset are already local time; do not assume UTC.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function snapshotMessage(snapshot: TrackingSnapshot, context: TrackingContext) {
  if (snapshot.availability === 'not_configured')
    return context === 'admin'
      ? '物流轨迹服务尚未开通，可复制单号前往查询网站。'
      : '物流轨迹暂不可查，可复制单号前往查询网站。';
  if (snapshot.message) return snapshot.message;
  switch (snapshot.availability) {
    case 'pending':
      return '快递公司暂未返回轨迹，交寄后可能需要一点时间。';
    case 'not_shipped':
      return '包裹尚未发货，发货后可查看物流。';
    case 'unsupported':
      return '当前快递暂不支持站内查询，可复制单号前往查询网站。';
    case 'updating':
      return '正在更新物流轨迹，请稍后刷新。';
    case 'unavailable':
      return '物流轨迹暂不可查，请稍后重试。';
    default:
      return '';
  }
}

export default function ShipmentTracking({
  shipment,
  context,
  viewToken,
}: {
  shipment: ShipmentReference;
  context: TrackingContext;
  viewToken?: string;
}) {
  const contentId = useId();
  const sequence = useRef(0),
    inFlight = useRef(false);
  const [expanded, setExpanded] = useState(false),
    [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [copyNotice, setCopyNotice] = useState(''),
    [showAll, setShowAll] = useState(false),
    [now, setNow] = useState(Date.now());

  useEffect(() => {
    sequence.current += 1;
    inFlight.current = false;
    setExpanded(false);
    setSnapshot(null);
    setLoading(false);
    setError('');
    setCopyNotice('');
    setShowAll(false);
    setNow(Date.now());
    return () => {
      sequence.current += 1;
      inFlight.current = false;
    };
  }, [shipment.id, shipment.carrier, shipment.tracking_no, shipment.status, context, viewToken]);

  const refreshAt = snapshot?.next_refresh_at ? Date.parse(snapshot.next_refresh_at) : 0;
  const refreshBlocked = Number.isFinite(refreshAt) && refreshAt > now;
  useEffect(() => {
    if (!refreshAt || !Number.isFinite(refreshAt) || refreshAt <= Date.now()) return;
    // Only update the button when its cooldown ends; this never fetches or polls.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(refreshAt - Date.now() + 50, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [refreshAt]);

  const carrier = resolveCarrier(snapshot?.carrier || shipment.carrier || '');
  const trackingNo = snapshot ? snapshot.tracking_no : shipment.tracking_no;
  const proposedQueryUrl = snapshot ? snapshot.query_url : carrier?.query_url;
  // External links stay on the fixed carrier directory, with no customer parameters.
  const queryUrl =
    proposedQueryUrl && CARRIERS.some((item) => item.query_url === proposedQueryUrl)
      ? proposedQueryUrl
      : null;
  const canTrack = shipment.status === 'shipped' && !!shipment.tracking_no;
  const needsAuthorization = context === 'order' && !viewToken;

  async function load() {
    if (inFlight.current || refreshBlocked || !canTrack || needsAuthorization) return;
    inFlight.current = true;
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const path = context === 'admin' ? '/admin/shipment-tracking' : `/${context}/tracking`;
      const next: TrackingSnapshot = await request(path, {
        shipment_id: shipment.id,
        ...(context === 'order' ? { view_token: viewToken } : {}),
      });
      if (current !== sequence.current) return;
      if (next.shipment_id !== shipment.id) throw Error('物流信息未能匹配，请重新查询');
      setSnapshot(next);
      setNow(Date.now());
    } catch (e) {
      if (current === sequence.current)
        setError(
          context === 'admin' && e instanceof Error
            ? e.message
            : '暂时无法查询物流，请稍后重试，或复制单号前往查询网站。',
        );
    } finally {
      if (current === sequence.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }

  function toggle() {
    setExpanded(!expanded);
    if (!expanded && !snapshot) void load();
  }

  async function copyTrackingNo() {
    if (!trackingNo) return;
    try {
      await navigator.clipboard.writeText(trackingNo);
      setCopyNotice('单号已复制');
    } catch {
      setCopyNotice('复制未成功，请长按或选中单号复制');
    }
  }

  const events = snapshot?.events || [];
  const visibleEvents = showAll ? events : events.slice(0, 6);
  const message = snapshot ? snapshotMessage(snapshot, context) : '';

  return (
    <section className="shipment-tracking" aria-label="包裹物流">
      <div className="shipment-tracking__reference">
        <span>{carrier?.name || shipment.carrier || '快递'}</span>
        {trackingNo ? (
          <code>{trackingNo}</code>
        ) : (
          <span className="shipment-tracking__muted">尚未录入单号</span>
        )}
        {trackingNo && (
          <button
            type="button"
            className="shipment-tracking__copy"
            onClick={copyTrackingNo}
            aria-label="复制物流单号"
          >
            <Copy size={15} aria-hidden="true" />
            复制
          </button>
        )}
      </div>
      {copyNotice && (
        <div className="shipment-tracking__notice" role="status">
          {copyNotice}
        </div>
      )}
      <div className="shipment-tracking__actions">
        {canTrack && (
          <button
            type="button"
            className="shipment-tracking__toggle"
            onClick={toggle}
            disabled={needsAuthorization}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {expanded ? '收起物流' : '查看物流'}
            <ChevronDown
              size={16}
              className={
                expanded ? 'shipment-tracking__chevron is-expanded' : 'shipment-tracking__chevron'
              }
              aria-hidden="true"
            />
          </button>
        )}
        {trackingNo && queryUrl && (
          <a href={queryUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
            {snapshot?.query_label || (carrier ? carrierQueryLabel(carrier) : '前往查询网站')}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {!canTrack && (
        <div className="shipment-tracking__muted">
          {shipment.status === 'cancelled'
            ? '本次预约已取消'
            : shipment.status === 'shipped'
              ? '物流单号待更新'
              : '尚未发货，发货后可查看物流'}
        </div>
      )}
      {canTrack && needsAuthorization && (
        <div className="shipment-tracking__muted">请重新查询订单后查看物流</div>
      )}
      {expanded && (
        <div className="shipment-tracking__content" id={contentId} aria-busy={loading}>
          <div className="shipment-tracking__heading">
            <strong>{snapshot?.state_label || '物流轨迹'}</strong>
            <button
              type="button"
              className="shipment-tracking__refresh"
              onClick={() => void load()}
              disabled={loading || refreshBlocked}
            >
              {loading ? (
                <LoaderCircle size={15} className="shipment-tracking__spinner" aria-hidden="true" />
              ) : (
                <RefreshCw size={15} aria-hidden="true" />
              )}
              {loading ? '查询中' : error ? '重试' : '刷新'}
            </button>
          </div>
          {loading && !snapshot && (
            <div className="shipment-tracking__muted" role="status">
              正在查询物流…
            </div>
          )}
          {error && (
            <div className="shipment-tracking__error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="shipment-tracking__muted" role="status">
              {message}
            </div>
          )}
          {snapshot?.stale && (
            <div className="shipment-tracking__muted">当前显示上次查询结果，稍后可刷新</div>
          )}
          {visibleEvents.length > 0 && (
            <ol className="shipment-tracking__timeline" aria-label="物流轨迹，最新记录在前">
              {visibleEvents.map((event, index) => (
                <li key={`${event.time}-${index}`}>
                  <time>{displayTime(event.time)}</time>
                  <div>{event.description}</div>
                </li>
              ))}
            </ol>
          )}
          {events.length > 6 && (
            <button
              type="button"
              className="shipment-tracking__more"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? '收起较早记录' : `查看全部 ${events.length} 条记录`}
            </button>
          )}
          {snapshot?.fetched_at && (
            <div className="shipment-tracking__updated">
              查询时间：{displayTime(snapshot.fetched_at)}（北京时间）
            </div>
          )}
          {refreshBlocked && (
            <div className="shipment-tracking__updated">
              {displayTime(snapshot?.next_refresh_at || null)} 后可再次刷新
            </div>
          )}
          <div className="shipment-tracking__updated">
            物流以快递公司更新为准，已发货不代表已签收
          </div>
        </div>
      )}
    </section>
  );
}
