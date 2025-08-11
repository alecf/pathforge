import KDBush from "kdbush";
import RBush from "rbush";

export type ProjectedActivitySimple = {
  id?: string | number;
  points: { x: number; y: number }[];
};

export interface IndexedPoint {
  x: number;
  y: number;
  activityId?: string | number;
  pointIndex: number;
}

export interface PointsIndex {
  index: KDBush;
  points: IndexedPoint[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface SegmentRecord {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  activityId?: string | number;
  pointStartIndex: number;
  pointEndIndex: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  length: number;
}

export interface SegmentGridIndex {
  tree: RBush<SegmentRecord>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function buildPointsIndex(
  activities: ProjectedActivitySimple[],
): PointsIndex | undefined {
  if (!activities || activities.length === 0) return undefined;

  const points: IndexedPoint[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const activity of activities) {
    const activityId = activity.id;
    const pts = activity.points ?? [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      points.push({ x: p.x, y: p.y, activityId, pointIndex: i });
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (points.length === 0) return undefined;

  // Build a static KDBush index
  const index = new KDBush(points.length, 16, Float32Array);
  for (const p of points) index.add(p.x, p.y);
  index.finish();

  return { index, points, bounds: { minX, maxX, minY, maxY } };
}

export function queryPointsWithinRadius(
  pointsIndex: PointsIndex | undefined,
  x: number,
  y: number,
  radius: number,
): IndexedPoint[] {
  if (!pointsIndex || !Number.isFinite(radius) || radius <= 0) return [];
  const r = radius;
  const ids = pointsIndex.index.range(x - r, y - r, x + r, y + r);
  if (!ids.length) return [];
  const r2 = r * r;
  const results: IndexedPoint[] = [];
  for (const id of ids) {
    const p = pointsIndex.points[id]!;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r2) results.push(p);
  }
  return results;
}

export function buildSegmentGridIndex(
  activities: ProjectedActivitySimple[],
  maxEntries?: number,
): SegmentGridIndex | undefined {
  if (!activities || activities.length === 0) return undefined;

  const segments: SegmentRecord[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const activity of activities) {
    const activityId = activity.id;
    const pts = activity.points ?? [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const minXi = Math.min(a.x, b.x);
      const maxXi = Math.max(a.x, b.x);
      const minYi = Math.min(a.y, b.y);
      const maxYi = Math.max(a.y, b.y);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        activityId,
        pointStartIndex: i,
        pointEndIndex: i + 1,
        minX: minXi,
        maxX: maxXi,
        minY: minYi,
        maxY: maxYi,
        length,
      });
      if (minXi < minX) minX = minXi;
      if (maxXi > maxX) maxX = maxXi;
      if (minYi < minY) minY = minYi;
      if (maxYi > maxY) maxY = maxYi;
    }
  }

  if (segments.length === 0) return undefined;
  const tree = new RBush<SegmentRecord>(maxEntries ?? 9);
  tree.load(segments);
  return { tree, bounds: { minX, maxX, minY, maxY } };
}

export function querySegmentsNear(
  segIndex: SegmentGridIndex | undefined,
  x: number,
  y: number,
  radius: number,
): SegmentRecord[] {
  if (!segIndex || !Number.isFinite(radius) || radius <= 0) return [];
  const { tree } = segIndex;
  const minQX = x - radius;
  const minQY = y - radius;
  const maxQX = x + radius;
  const maxQY = y + radius;
  return tree.search({ minX: minQX, minY: minQY, maxX: maxQX, maxY: maxQY });
}

export function isPointNearAnySegment(
  segIndex: SegmentGridIndex | undefined,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (!segIndex || !Number.isFinite(radius) || radius <= 0) return false;
  const r2 = radius * radius;
  const candidates = querySegmentsNear(segIndex, x, y, radius);
  for (const s of candidates) {
    // project point to segment and check squared distance
    const segX = s.x1 - s.x0;
    const segY = s.y1 - s.y0;
    const toPointX = x - s.x0;
    const toPointY = y - s.y0;
    const segLen2 = segX * segX + segY * segY || 1e-9;
    let t = (toPointX * segX + toPointY * segY) / segLen2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = s.x0 + t * segX;
    const cy = s.y0 + t * segY;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
