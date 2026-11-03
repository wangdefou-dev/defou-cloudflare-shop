import { useEffect, useRef, useState } from 'react';
import { MapPin, Pause, Play, RefreshCw, ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react';
import { ErrorBox, PageIntro } from './ui';
import {
  MAP_BASE,
  MAP_PROVINCES,
  MAP_DECORATIONS,
  MAP_ORIGIN,
  cityPoint,
  cityName,
  cityQuantity,
  footprintSummary,
  mapClipPath,
  routePath,
  type MapCity,
  type MapMode,
  type MapSnapshot,
} from '../lib/map-geometry';
import '../styles/footprint-map.css';

const purchaseColor = '#b53a2c',
  sponsorColor = '#aa772c',
  giftColor = '#277d81';
const provincePalette = ['#dce7d2', '#b9cfa6', '#87ab77', '#507956'];
const labels: Record<MapMode, string> = {
  all: '全部足迹',
  orders: '购买与认领寄送',
  sponsor: '请你吃苹果',
  gift: '赠送苹果',
};
const sourceColor = (city: MapCity, mode: MapMode) => {
  if (mode === 'gift') return giftColor;
  if (mode === 'sponsor') return sponsorColor;
  if (city.boxes + city.adopted > 0) return purchaseColor;
  return city.sponsored > 0 ? sponsorColor : giftColor;
};
const origin = cityPoint(MAP_ORIGIN.code)!;
const empty: MapSnapshot = { cities: [], recent: [], adoption_trees: 0, updated_at: '' };
const shortProvince = (name: string) =>
  name.replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|省$|市$/g, '');
const guidedProvinceCodes = new Set(['110000', '120000', '310000']);
function AppleMark() {
  return (
    <g transform="translate(-12 -12)">
      <path
        d="M12 7c-3-3-8-1-8 4 0 6 4 11 7 8 1-1 1-1 2 0 3 3 7-2 7-8 0-5-5-7-8-4Z"
        fill={purchaseColor}
      />
      <path d="M12 7c0-3 2-5 5-5-1 3-2 4-5 5" fill="#42683e" />
    </g>
  );
}
export default function MapPage() {
  const [data, setData] = useState<MapSnapshot>(empty),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selectedCode, setSelectedCode] = useState(''),
    [provinceCode, setProvinceCode] = useState(''),
    [hoverProvinceCode, setHoverProvinceCode] = useState(''),
    [focusedProvinceCode, setFocusedProvinceCode] = useState(''),
    [mode, setMode] = useState<MapMode>('all'),
    [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(false),
    [onScreen, setOnScreen] = useState(true),
    [pageVisible, setPageVisible] = useState(true),
    [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null),
    stage = useRef<HTMLDivElement>(null),
    active = useRef(true),
    controller = useRef<AbortController | null>(null);
  async function refresh() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    const timeout = window.setTimeout(() => current.abort('timeout'), 15000);
    try {
      const response = await fetch('/api/map', { cache: 'no-store', signal: current.signal });
      if (!response.ok) throw Error('城市足迹暂时未能更新，请稍后重试');
      const snapshot = (await response.json()) as MapSnapshot;
      if (!Array.isArray(snapshot.cities)) throw Error('城市足迹数据暂时不可用');
      if (active.current && controller.current === current && !current.signal.aborted)
        setData(snapshot);
    } catch (e) {
      if (active.current && controller.current === current)
        setError(
          current.signal.reason === 'timeout'
            ? '城市足迹更新超时，请点击刷新重试'
            : (e as Error).message,
        );
    } finally {
      window.clearTimeout(timeout);
      if (active.current && controller.current === current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void refresh();
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    motion();
    media.addEventListener('change', motion);
    const visibility = () => {
      setPageVisible(!document.hidden);
      if (!document.hidden) void refresh();
    };
    setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      rootMargin: '100px',
    });
    if (stage.current) observer.observe(stage.current);
    return () => {
      active.current = false;
      controller.current?.abort();
      window.clearInterval(timer);
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, []);
  const running = !paused && !reduced && onScreen && pageVisible;
  useEffect(() => {
    if (running) svg.current?.unpauseAnimations?.();
    else svg.current?.pauseAnimations?.();
  }, [running]);
  const { cities: nationalCities, total, provinces } = footprintSummary(data, mode);
  const selectedProvince = MAP_PROVINCES.find((province) => province.code === provinceCode);
  const hoveredProvince = MAP_PROVINCES.find(
    (province) => province.code === (hoverProvinceCode || focusedProvinceCode),
  );
  const cities = provinceCode
    ? nationalCities.filter((city) => city.province_code === provinceCode)
    : nationalCities;
  useEffect(() => {
    if (selectedCode && !cities.some((city) => city.city_code === selectedCode))
      setSelectedCode('');
  }, [data, mode, provinceCode, selectedCode]);
  const selected = cities.find((city) => city.city_code === selectedCode);
  const provinceTotals = new Map<string, number>();
  for (const city of nationalCities)
    provinceTotals.set(
      city.province_code,
      (provinceTotals.get(city.province_code) || 0) + cityQuantity(city, mode),
    );
  const maxProvince = Math.max(1, ...provinceTotals.values());
  const provinceFill = (code: string) => {
    const qty = provinceTotals.get(code) || 0;
    return qty > 0
      ? provincePalette[Math.min(3, Math.floor(Math.sqrt(qty / maxProvince) * 4))]
      : 'var(--footprint-empty-province)';
  };
  const located = cities.flatMap((city) => {
    const point = cityPoint(city.city_code);
    return point ? [{ city, point }] : [];
  });
  const defaultLabels: typeof located = [];
  if (!selectedCode) {
    for (const entry of located) {
      if (defaultLabels.length === 3) break;
      if (Math.hypot(entry.point.x - origin.x, entry.point.y - origin.y) < 90) continue;
      if (
        defaultLabels.every(
          ({ point }) => Math.hypot(entry.point.x - point.x, entry.point.y - point.y) >= 100,
        )
      )
        defaultLabels.push(entry);
    }
  }
  const routes = located.flatMap(({ city, point }) => {
    const path = routePath(origin, point);
    return path ? [{ city, path, color: sourceColor(city, mode) }] : [];
  });
  const missing = cities.length - located.length;
  const choose = (city: MapCity) =>
    setSelectedCode(city.city_code === selectedCode ? '' : city.city_code);
  const chooseProvince = (code: string) => {
    setProvinceCode(code);
    setSelectedCode('');
  };
  return (
    <div className="page-wrap footprint-page">
      <PageIntro eyebrow="FROM THE MOUNTAINS, WITH LOVE" title="一箱一箱，点亮远方">
        从示例产地出发，把山里的清甜，寄向真实的收货城市。
        <br />
        每一条连接，都记录着购买、认领寄送、社区赞助或赠送的心意。
      </PageIntro>
      <div className="map-stats footprint-stats" aria-live="polite">
        <div>
          <strong>{data.updated_at ? total : '—'}</strong>
          <span>箱苹果的旅程</span>
        </div>
        <div>
          <strong>{data.updated_at ? data.adoption_trees : '—'}</strong>
          <span>棵本季果树已认领</span>
        </div>
        <div>
          <strong>{data.updated_at ? nationalCities.length : '—'}</strong>
          <span>座城市被连接</span>
        </div>
        <div>
          <strong>{data.updated_at ? provinces : '—'}</strong>
          <span>个省级地区</span>
        </div>
        <div className="map-origin">
          <MapPin size={26} strokeWidth={1} />
          <span>
            起点
            <br />
            <strong>示例产地</strong>
          </span>
        </div>
      </div>
      <div className="footprint-toolbar">
        <div className="tab-bar map-tabs" role="group" aria-label="足迹来源">
          {(Object.entries(labels) as [MapMode, string][]).map(([value, label]) => (
            <button
              key={value}
              className={mode === value ? 'selected' : ''}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setSelectedCode('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="footprint-actions">
          <div className="footprint-zoom" role="group" aria-label="地图缩放">
            <button
              aria-label="放大地图"
              disabled={zoom >= 2}
              onClick={() => setZoom(Math.min(2, zoom + 0.25))}
            >
              <ZoomIn size={16} />
            </button>
            <button
              aria-label="缩小地图"
              disabled={zoom <= 1}
              onClick={() => setZoom(Math.max(1, zoom - 0.25))}
            >
              <ZoomOut size={16} />
            </button>
            <button aria-label="还原完整地图" onClick={() => setZoom(1)}>
              <RotateCcw size={15} />
            </button>
          </div>
          <button disabled={reduced} aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused || reduced ? <Play size={15} /> : <Pause size={15} />}
            {reduced ? '已遵循减少动态效果' : paused ? '播放动效' : '暂停动效'}
          </button>
          <button disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={15} />
            {loading ? '正在更新' : '刷新足迹'}
          </button>
        </div>
      </div>
      <ErrorBox text={error} />
      <div className="map-layout footprint-layout">
        <section
          className={'map-canvas footprint-stage' + (selected ? ' has-selection' : '')}
          ref={stage}
          data-running={running}
          data-reduced={reduced}
          aria-label="从示例产地到收货城市的交互地图"
        >
          <div className="footprint-map-heading">
            <div>
              <strong>{selectedProvince ? selectedProvince.name : '全国城市足迹'}</strong>
              <span>
                {selectedProvince
                  ? data.updated_at
                    ? `${provinceTotals.get(provinceCode) || 0} 箱 · ${cities.length} 座城市`
                    : '正在读取城市足迹…'
                  : '点击省份，看看心意去了哪里'}
              </span>
            </div>
            <label className="footprint-province-select">
              <span>查看省份</span>
              <select
                aria-label="查看省份"
                value={provinceCode}
                onChange={(e) => chooseProvince(e.currentTarget.value)}
              >
                <option value="">全国</option>
                {MAP_PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedProvince && (
            <div className="footprint-province-scope" role="status">
              <span>
                正在查看{selectedProvince.name}的「{labels[mode]}」，上方保留全国累计
              </span>
              <button type="button" onClick={() => chooseProvince('')}>
                查看全国 <X size={13} />
              </button>
            </div>
          )}
          <div className="footprint-scroller">
            <div className="footprint-art" style={{ width: zoom * 100 + '%' }}>
              <svg
                ref={svg}
                viewBox={`0 0 ${MAP_BASE.width} ${MAP_BASE.height}`}
                role="group"
                aria-label="省份分布与城市连接，飞线不代表实时物流"
              >
                <defs>
                  <clipPath id="footprint-vector-window">
                    <rect width={MAP_BASE.width} height={MAP_BASE.height} />
                  </clipPath>
                  <clipPath id="footprint-main-window">
                    <path clipRule="evenodd" d={mapClipPath()} />
                  </clipPath>
                </defs>
                <g clipPath="url(#footprint-vector-window)">
                  <g className="footprint-provinces">
                    {MAP_PROVINCES.map((province) => {
                      const qty = provinceTotals.get(province.code) || 0;
                      const chosen = provinceCode === province.code;
                      return (
                        <g
                          key={province.code}
                          role="button"
                          tabIndex={0}
                          aria-pressed={chosen}
                          aria-label={`${province.name}，${data.updated_at ? qty + '箱' : '数据读取中'}，查看城市`}
                          className={
                            'footprint-province' +
                            (chosen ? ' is-selected' : '') +
                            (provinceCode && !chosen ? ' is-muted' : '')
                          }
                          onClick={() => chooseProvince(chosen ? '' : province.code)}
                          onMouseEnter={() => setHoverProvinceCode(province.code)}
                          onMouseLeave={() => setHoverProvinceCode('')}
                          onFocus={() => setFocusedProvinceCode(province.code)}
                          onBlur={() => setFocusedProvinceCode('')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              chooseProvince(chosen ? '' : province.code);
                            }
                          }}
                        >
                          <title>
                            {province.name} · {data.updated_at ? qty + ' 箱' : '数据读取中'} ·
                            点击查看城市
                          </title>
                          <path
                            d={province.path}
                            fill={provinceFill(province.code)}
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      );
                    })}
                  </g>
                  <g className="footprint-decorations" aria-hidden="true">
                    {MAP_DECORATIONS.map((decoration) => (
                      <path
                        key={decoration.id}
                        d={decoration.path}
                        className={'footprint-decoration ' + decoration.kind}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <text
                      x="885"
                      y="686"
                      textAnchor="middle"
                      className="footprint-inset-label"
                      vectorEffect="non-scaling-stroke"
                    >
                      南海诸岛
                    </text>
                  </g>
                  <g className="footprint-province-labels" aria-hidden="true">
                    {MAP_PROVINCES.map((province) => {
                      if (!province.label) return null;
                      const anchor = guidedProvinceCodes.has(province.code)
                        ? cityPoint(province.code)
                        : null;
                      return (
                        <g
                          key={province.code}
                          className={
                            provinceCode && provinceCode !== province.code ? 'is-muted' : ''
                          }
                        >
                          {anchor && (
                            <path
                              d={`M${anchor.x} ${anchor.y}L${province.label.x} ${province.label.y}`}
                              className="footprint-label-guide"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <text
                            x={province.label.x}
                            y={province.label.y}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            vectorEffect="non-scaling-stroke"
                          >
                            {shortProvince(province.name)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                  <g clipPath="url(#footprint-main-window)">
                    <g className="footprint-routes">
                      {routes.map(({ city, path, color }, index) => {
                        const chosen = city.city_code === selectedCode;
                        return (
                          <g key={city.city_code}>
                            <path
                              d={path}
                              className={
                                'footprint-route route-halo' + (chosen ? ' is-selected' : '')
                              }
                              vectorEffect="non-scaling-stroke"
                            />
                            <path
                              id={'footprint-route-' + city.city_code}
                              d={path}
                              stroke={color}
                              className={'footprint-route' + (chosen ? ' is-selected' : '')}
                              vectorEffect="non-scaling-stroke"
                            />
                            {index < 24 && !reduced && (
                              <g className="footprint-traveler" aria-hidden="true">
                                <circle r="9" fill="#fff" fillOpacity=".92" />
                                <g transform="scale(.63)">
                                  <AppleMark />
                                </g>
                                <animateMotion
                                  dur={4 + (index % 4) * 0.7 + 's'}
                                  begin={-(index * 0.6) + 's'}
                                  repeatCount="indefinite"
                                  rotate="0"
                                >
                                  <mpath href={'#footprint-route-' + city.city_code} />
                                </animateMotion>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </g>
                    <g className="footprint-city-points">
                      {located
                        .filter(({ city }) => city.city_code !== MAP_ORIGIN.code)
                        .map(({ city, point }) => {
                          const color = sourceColor(city, mode);
                          return (
                            <g
                              key={city.city_code}
                              className="footprint-city"
                              role="button"
                              tabIndex={0}
                              aria-pressed={selectedCode === city.city_code}
                              aria-label={cityName(city) + '，' + cityQuantity(city, mode) + '箱'}
                              onMouseEnter={() => setHoverProvinceCode(city.province_code)}
                              onMouseLeave={() => setHoverProvinceCode('')}
                              onFocus={() => setFocusedProvinceCode(city.province_code)}
                              onBlur={() => setFocusedProvinceCode('')}
                              onClick={() => choose(city)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  choose(city);
                                }
                              }}
                            >
                              <title>
                                {'示例产地 → ' +
                                  cityName(city) +
                                  ' · ' +
                                  cityQuantity(city, mode) +
                                  ' 箱'}
                              </title>
                              <circle cx={point.x} cy={point.y} r="17" fill="transparent" />
                              <circle
                                className="footprint-pulse"
                                cx={point.x}
                                cy={point.y}
                                r="7"
                                stroke={color}
                                vectorEffect="non-scaling-stroke"
                              />
                              <circle
                                className="footprint-core"
                                cx={point.x}
                                cy={point.y}
                                r={selectedCode === city.city_code ? 8 : 6}
                                fill={color}
                                vectorEffect="non-scaling-stroke"
                              />
                              {(selectedCode === city.city_code ||
                                (!selectedCode &&
                                  defaultLabels.some(
                                    (entry) => entry.city.city_code === city.city_code,
                                  ))) && (
                                <text
                                  className="footprint-point-label"
                                  x={point.x + (point.x > MAP_BASE.width * 0.83 ? -15 : 15)}
                                  y={point.y - 15}
                                  textAnchor={point.x > MAP_BASE.width * 0.83 ? 'end' : 'start'}
                                  vectorEffect="non-scaling-stroke"
                                >
                                  {cityName(city)}
                                  {selectedCode ? '' : ` ${cityQuantity(city, mode)}箱`}
                                </text>
                              )}
                            </g>
                          );
                        })}
                    </g>
                    <g
                      className="footprint-origin"
                      transform={`translate(${origin.x} ${origin.y})`}
                      aria-label="起点，示例产地城市参考点"
                    >
                      <circle r="15" fill="#fff" />
                      <circle r="11" fill="#294b38" />
                      <g transform="scale(.7)">
                        <AppleMark />
                      </g>
                      <text
                        className="footprint-origin-label"
                        x="-21"
                        y="-21"
                        textAnchor="end"
                        vectorEffect="non-scaling-stroke"
                      >
                        示例产地
                      </text>
                    </g>
                  </g>
                  {selectedProvince && (
                    <path
                      className="footprint-province-outline"
                      d={selectedProvince.path}
                      vectorEffect="non-scaling-stroke"
                      aria-hidden="true"
                    />
                  )}
                  {hoveredProvince && (
                    <path
                      className="footprint-province-outline is-hovered"
                      d={hoveredProvince.path}
                      vectorEffect="non-scaling-stroke"
                      aria-hidden="true"
                    />
                  )}
                </g>
              </svg>
            </div>
          </div>
          <div className="footprint-map-key">
            <span className="footprint-province-hover">
              {hoveredProvince
                ? `${hoveredProvince.name} · ${data.updated_at ? (provinceTotals.get(hoveredProvince.code) || 0) + ' 箱' : '数据读取中'}`
                : data.updated_at
                  ? '省份底色随当前来源的真实箱数变化'
                  : '正在读取城市汇总，暂不显示分布'}
            </span>
            <div className="footprint-scale" aria-label="省份颜色越深，箱数越多">
              <i className="empty" />
              暂无足迹
              <span className="footprint-scale-swatches">
                {provincePalette.map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              少 → 多
            </div>
          </div>
          {selected && (
            <div className="footprint-selection" role="status">
              <MapPin size={18} />
              <div>
                <strong>{selected.region_label.split(' / ').join(' · ')}</strong>
                <p>
                  {mode === 'gift' ? '赠送 ' : ''}
                  {cityQuantity(selected, mode)} 箱
                  {mode === 'all'
                    ? `，购买 ${selected.boxes} 箱，认领预约 ${selected.adopted} 箱，社区赞助 ${selected.sponsored} 箱，赠送 ${selected.gifted ?? 0} 箱`
                    : ''}
                </p>
                {!cityPoint(selected.city_code) && <p>城市坐标待补齐，箱数已计入统计</p>}
              </div>
              <button onClick={() => setSelectedCode('')} aria-label="关闭城市信息">
                <X size={18} />
              </button>
            </div>
          )}
          <div className="footprint-map-credit">
            地理数据：{MAP_BASE.source_label} · 城市参考点不代表果园或收件人定位
            <br />
            <a href={MAP_BASE.source_url} target="_blank" rel="noopener noreferrer">
              查看地理数据来源
            </a>
            {' · '}
            <a href={MAP_BASE.license_url} target="_blank" rel="noopener">
              数据来源与许可
            </a>
          </div>
        </section>
        <aside className="city-ranking footprint-ranking">
          <div className="eyebrow">TOP 10 DESTINATIONS</div>
          <h2>
            {selectedProvince
              ? shortProvince(selectedProvince.name) + '的城市足迹'
              : '心意，去了这些地方'}
          </h2>
          <p className="footprint-ranking-scope">
            {selectedProvince ? selectedProvince.name : '全国'} · {labels[mode]}
          </p>
          <div className="footprint-city-list">
            {cities.length ? (
              cities.slice(0, 10).map((city, index) => (
                <button
                  className="city-row"
                  key={city.city_code}
                  aria-pressed={selectedCode === city.city_code}
                  onClick={() => choose(city)}
                >
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <span>
                    {cityName(city)}
                    <i
                      style={{
                        background: sourceColor(city, mode),
                        width:
                          Math.max(
                            5,
                            (cityQuantity(city, mode) /
                              Math.max(1, ...cities.map((entry) => cityQuantity(entry, mode)))) *
                              100,
                          ) + '%',
                      }}
                    />
                  </span>
                  <strong>
                    {cityQuantity(city, mode)}
                    <small> 箱</small>
                  </strong>
                </button>
              ))
            ) : (
              <p className="empty-inline">
                {loading && !data.updated_at
                  ? '正在读取真实城市足迹…'
                  : selectedProvince
                    ? '这个省份暂时没有这一类城市足迹。'
                    : '这一类足迹，正在等待出发。'}
              </p>
            )}
          </div>
          <div className="map-legend">
            <span>
              <i style={{ background: purchaseColor }} />
              购买与认领寄送
            </span>
            <span>
              <i style={{ background: sponsorColor }} />
              社区赞助
            </span>
            <span>
              <i style={{ background: giftColor }} />
              赠送苹果
            </span>
          </div>
          <p className="footprint-status" role="status">
            {loading
              ? '正在更新城市汇总'
              : data.updated_at
                ? '每分钟自动更新，点击城市查看箱数'
                : '城市汇总暂未载入'}
            {missing > 0 && (
              <>
                <br />
                {missing} 座城市的参考点待补齐，已计入统计。
              </>
            )}
            {routes.length > 24 && (
              <>
                <br />
                动效展示前 24 条连线，其余保留静态线路。
              </>
            )}
          </p>
        </aside>
      </div>
      <p className="fine-print centered footprint-map-note">
        仅展示真实收货城市的汇总，不展示姓名、电话、区县或门牌。飞线是城市间连接示意，不代表实际运输路线或快递实时位置。
        <br />
        认领棵数按已付款的有效认领统计；旅程箱数在购买支付成功、认领预约生效、赞助发货、赠送确认寄出时计入。购买或认领整单退款扣除对应数量，坏果部分赔付不扣除。
      </p>
    </div>
  );
}
