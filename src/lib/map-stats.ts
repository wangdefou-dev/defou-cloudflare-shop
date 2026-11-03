export type JourneyCounts = { boxes: number; adopted: number; sponsored: number; gifted?: number };
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
export function journeyBoxes(c: JourneyCounts) {
  return n(c.boxes) + n(c.adopted) + n(c.sponsored) + n(c.gifted);
}
