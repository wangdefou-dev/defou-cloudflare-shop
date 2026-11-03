import site from '../../config/site.json';
import { useEffect, useState } from 'react';
import ResponsivePhoto from './ResponsivePhoto';
import { SCENE_IMAGES } from '../lib/media';
import { ArrowUpRight, Sun, Users } from 'lucide-react';
import {
  AddressForm,
  Button,
  emptyAddress,
  ErrorBox,
  Field,
  PageIntro,
  request,
  Turnstile,
  useConfig,
} from './ui';
import { chinaDate, SPONSOR_MIN_HEADCOUNT, statusNames } from '../lib/shared';
export default function Treat() {
  const { data: c } = useConfig(),
    [tab, setTab] = useState('apply'),
    [address, setAddress] = useState(emptyAddress),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState(''),
    [wall, setWall] = useState<any[]>([]),
    [status, setStatus] = useState<any>(null);
  useEffect(() => {
    request('/wall')
      .then(setWall)
      .catch(() => {});
  }, []);
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      if (tab === 'lookup') {
        setStatus(
          await request('/treat/lookup', {
            phone: f.get('phone'),
            app_no: f.get('app_no'),
            turnstile: token,
          }),
        );
      } else {
        const a = await request('/treat/apply', {
          org_name: f.get('org_name'),
          event_name: f.get('event_name'),
          event_date: f.get('event_date'),
          headcount: Number(f.get('headcount')),
          contact: f.get('contact'),
          phone: f.get('phone'),
          wechat: f.get('wechat') || '',
          reason: f.get('reason'),
          link: f.get('link') || '',
          address,
          agree_photos: f.get('agree_photos') === 'on',
          turnstile: token,
        });
        setReceipt(a.app_no);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-wrap">
      <div className="treat-intro">
        <PageIntro eyebrow="GOOD APPLES, GOOD COMPANY" title="你们相聚，苹果算我的">
          读书会、技术聚会、社区活动，或一场有意思的线下相遇。
          <br />
          {site.publisher} 想用一箱苹果，为你们的相聚添一点甜。
        </PageIntro>
        <Sun className="treat-sun" size={145} strokeWidth={0.7} />
      </div>
      <div className="treat-values">
        <span>
          <Users size={20} />
          不限活动类型，人工认真审核
        </span>
        <span>♡ 不设固定名额，好的相聚值得支持</span>
        <span>↗ 活动后返 1–3 张现场照片就好</span>
      </div>
      <div className="treat-layout">
        <section className="form-panel">
          <div className="tab-bar">
            <button
              className={tab === 'apply' ? 'selected' : ''}
              onClick={() => {
                setTab('apply');
                setError('');
              }}
            >
              申请一份甜
            </button>
            <button
              className={tab === 'lookup' ? 'selected' : ''}
              onClick={() => {
                setTab('lookup');
                setError('');
              }}
            >
              查申请进度
            </button>
          </div>
          {receipt && tab === 'apply' ? (
            <div className="receipt">
              <Sun size={55} />
              <h2>收到，你的相聚邀请</h2>
              <p>我们会认真看完，并通过电话或微信与你联系。</p>
              <strong className="code-block">{receipt}</strong>
              <p>请截图保存申请编号，可凭手机号和编号查询进度。</p>
            </div>
          ) : (
            <form onSubmit={submit} key={tab}>
              {tab === 'apply' ? (
                <>
                  <div className="form-grid">
                    <Field label="组织名字">
                      <input
                        name="org_name"
                        required
                        minLength={2}
                        maxLength={60}
                        placeholder="社区 / 社群 / 团队"
                      />
                    </Field>
                    <Field label="活动名称">
                      <input
                        name="event_name"
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="这次，因为什么聚在一起？"
                      />
                    </Field>
                    <Field label="活动日期">
                      <input
                        name="event_date"
                        required
                        type="date"
                        min={chinaDate(6)}
                        max={site.season.end}
                      />
                    </Field>
                    <Field label="预计参加人数" hint={`至少 ${SPONSOR_MIN_HEADCOUNT} 人参加`}>
                      <input
                        name="headcount"
                        type="number"
                        required
                        min={SPONSOR_MIN_HEADCOUNT}
                        step={1}
                        max={100000}
                        placeholder={`至少 ${SPONSOR_MIN_HEADCOUNT} 人`}
                      />
                    </Field>
                    <Field label="联系人">
                      <input name="contact" required maxLength={30} />
                    </Field>
                    <Field label="联系手机号">
                      <input
                        name="phone"
                        required
                        inputMode="tel"
                        pattern="1[3-9][0-9]{9}"
                        maxLength={11}
                      />
                    </Field>
                  </div>
                  <Field label="微信号（选填）">
                    <input name="wechat" maxLength={50} />
                  </Field>
                  <Field label="活动链接 / 海报链接（选填）">
                    <input name="link" type="url" placeholder="https://" maxLength={1000} />
                  </Field>
                  <Field
                    label="说说这场相聚"
                    hint="至少 30 字。介绍活动和社区，也说说为什么想邀请苹果来。"
                  >
                    <textarea name="reason" required minLength={30} maxLength={2000} rows={4} />
                  </Field>
                  <h3 className="form-subtitle">如果通过，苹果寄到这里</h3>
                  <AddressForm value={address} onChange={setAddress} />
                  <label className="check-row align-top">
                    <input type="checkbox" required name="agree_photos" />
                    <span>
                      同意活动后返 1–3 张现场照片。公开展示前会再次征求授权。我已阅读{' '}
                      <a href="/privacy" target="_blank">
                        隐私说明
                      </a>
                      。
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <Field label="联系手机号">
                    <input
                      name="phone"
                      required
                      inputMode="tel"
                      pattern="1[3-9][0-9]{9}"
                      maxLength={11}
                    />
                  </Field>
                  <Field label="申请编号">
                    <input name="app_no" required placeholder="AP-…" />
                  </Field>
                </>
              )}
              <Turnstile demo={c?.demo} siteKey={c?.turnstile_site_key} onToken={setToken} />
              <ErrorBox text={error} />
              <Button busy={busy} disabled={!c || !token}>
                {tab === 'lookup' ? '查询进度' : '把相聚邀请寄给我们'}
                <ArrowUpRight size={18} />
              </Button>
            </form>
          )}
          {tab === 'lookup' && status && (
            <div className="lookup-result">
              <span className="status-tag">
                {status.status === 'pending' ? '待审核' : statusNames[status.status]}
              </span>
              <h3>{status.event_name}</h3>
              <p>
                {status.boxes_granted
                  ? `赠送 ${status.boxes_granted} 箱`
                  : '运营会通过电话 / 微信联系你'}
              </p>
              {status.rejection_reason && <p>{status.rejection_reason}</p>}
            </div>
          )}
        </section>
        <aside className="treat-aside">
          <figure className="aside-concept">
            <ResponsivePhoto photo={SCENE_IMAGES.COMMUNITY} sizes="300px" />
          </figure>
          <div className="eyebrow">A LITTLE NOTE FROM US</div>
          <h2>
            技术连接世界，
            <br />
            苹果连接彼此
          </h2>
          <p>
            平时在网上认识了很多朋友。想找个朴素的方式，让屏幕另一头的大家，也能尝到山间果园的秋天。
          </p>
          <p>
            不用把活动做得很大，也不用为苹果专门安排什么。
            <br />
            你们好好相聚，就很好。
          </p>
          <div className="hand-sign">果园主</div>
          <hr />
          <small>
            同一手机号 30 天内仅可申请一次。活动须晚于今天 5 天，最晚 {site.season.end}，为果园和快递留一点时间。
          </small>
        </aside>
      </div>
      <section className="activity-wall">
        <div className="eyebrow">SWEET MOMENTS TOGETHER</div>
        <div className="section-heading">
          <h2>已经相聚过的甜</h2>
          <span>
            {wall.length} 场相聚 · {wall.reduce((s, a) => s + a.headcount, 0)} 位朋友
          </span>
        </div>
        {wall.length ? (
          <div className="diary-grid">
            {wall.map((a: any, i) => (
              <article key={i}>
                {a.photos.slice(0, 1).map((src: string) => (
                  <img src={src} alt={a.event_name} key={src} loading="lazy" />
                ))}
                <time>
                  {a.city} · {a.event_date}
                </time>
                <h3>{a.event_name}</h3>
                <p>{a.headcount} 人的相聚</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-diary">
            <Sun size={45} strokeWidth={1} />
            <p>
              第一场相聚，会是什么样子？
              <br />
              <small>这里会留下经过授权的真实活动照片。</small>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
