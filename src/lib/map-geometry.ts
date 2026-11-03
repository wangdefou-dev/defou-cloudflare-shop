import site from '../../config/site.json';
import { journeyBoxes } from './map-stats';
import coordinates from './map-cities.json';
import base from './map-base.json';
import geometry from './map-provinces.json';
export const MAP_BASE = base;
export const MAP_PROVINCES = geometry.provinces;
export const MAP_DECORATIONS = geometry.decorations as {
  id: string;
  path: string;
  kind: 'outline' | 'islands' | 'sea-lines';
}[];
export const MAP_ORIGIN = site.mapOrigin;
export type MapMode = 'all' | 'orders' | 'sponsor' | 'gift';
export type MapCity = {
  city_code: string;
  province_code: string;
  region_label: string;
  boxes: number;
  adopted: number;
  sponsored: number;
  gifted?: number;
};
export type MapSnapshot = {
  cities: MapCity[];
  adoption_trees: number;
  recent: { region_label: string; qty: number; source: string }[];
  updated_at: string;
};
export type MapPoint = { x: number; y: number };
export const cityQuantity = (c: MapCity, mode: MapMode) =>
  mode === 'orders'
    ? Number(c.boxes) + Number(c.adopted)
    : mode === 'sponsor'
      ? Number(c.sponsored)
      : mode === 'gift'
        ? Number(c.gifted ?? 0)
        : journeyBoxes(c);
export const cityName = (c: MapCity) => c.region_label.split(/\s*\/\s*/)[1] || c.region_label;
export function cityCode(code: string) {
  if (!/^\d{6}$/.test(code)) return '';
  return ['11', '12', '31', '50'].includes(code.slice(0, 2)) ? code.slice(0, 2) + '0000' : code;
}
export function projectCityPoint(lng: number, lat: number): MapPoint | null {
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < 70 ||
    lng > 140 ||
    lat < 15 ||
    lat > 55
  )
    return null;
  const p = base.projection;
  return {
    x: p.x_scale * lng + p.x_offset,
    y: p.y_scale * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) + p.y_offset,
  };
}
export function cityPoint(code: string): MapPoint | null {
  const key = cityCode(code);
  if (!Object.hasOwn(coordinates, key)) return null;
  const point = (coordinates as Record<string, number[]>)[key];
  const projected = projectCityPoint(point[0], point[1]);
  const [left, top, right, bottom] = base.overlay.bounds;
  // Never put a guessed city point outside the drawing or in the illustrative sea inset.
  if (
    !projected ||
    projected.x < left ||
    projected.x > right ||
    projected.y < top ||
    projected.y > bottom ||
    base.overlay.exclusions.some(
      ([x1, y1, x2, y2]) =>
        projected.x >= x1 && projected.x <= x2 && projected.y >= y1 && projected.y <= y2,
    )
  )
    return null;
  return projected;
}
export function mapClipPath() {
  return [base.overlay.bounds, ...base.overlay.exclusions]
    .map(([x1, y1, x2, y2]) => `M${x1} ${y1}H${x2}V${y2}H${x1}Z`)
    .join(' ');
}
export function routePath(start: MapPoint, end: MapPoint) {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 1) return '';
  const bend = Math.min(90, Math.hypot(dx, dy) * 0.2);
  const length = Math.hypot(dx, dy);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${((start.x + end.x) / 2 + (dy / length) * bend).toFixed(2)} ${((start.y + end.y) / 2 - (dx / length) * bend).toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
export function footprintSummary(snapshot: MapSnapshot, mode: MapMode) {
  const cities = snapshot.cities
    .filter((c) => cityQuantity(c, mode) > 0)
    .sort(
      (a, b) =>
        cityQuantity(b, mode) - cityQuantity(a, mode) || a.city_code.localeCompare(b.city_code),
    );
  return {
    cities,
    total: cities.reduce((n, c) => n + cityQuantity(c, mode), 0),
    provinces: new Set(cities.map((c) => c.province_code)).size,
  };
}
