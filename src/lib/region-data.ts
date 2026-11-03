import { prefix } from './region-assets.json';
const pending = new Map<string, Promise<unknown[]>>();
export function regionChildren(parent = 'root'): Promise<any[]> {
  if (parent !== 'root' && !/^\d{6}$/.test(parent)) return Promise.reject(Error('请选择有效地区'));
  let promise = pending.get(parent);
  if (!promise) {
    promise = fetch(prefix + parent + '.json', {
      credentials: 'omit',
      cache: 'force-cache',
    })
      .then((r) => {
        if (!r.ok) throw Error('地区数据加载失败，请重试');
        return r.json() as Promise<unknown[]>;
      })
      .catch((e) => {
        pending.delete(parent);
        throw e;
      });
    pending.set(parent, promise);
  }
  return promise;
}
