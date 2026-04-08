export type Vector2 = { x: number; y: number; z?: number };

export type StrokeBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type Stroke = {
  id: string;
  points: Vector2[];
  color: string;
  thickness: number;
  scale: number;
  rotation: number;
  translate: Vector2;
  centroid: Vector2; // cached centroid for O(1) hover/select lookups
  bounds: StrokeBounds; // cached bounding box for O(1) render setup
  birthTime: number; // timestamp for birth animation
};

// ─── Shape generators: return normalized points centered at (cx, cy) with given size ──
export function generateCirclePoints(cx: number, cy: number, radius: number, segments = 64): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return pts;
}

export function generatePolygonPoints(cx: number, cy: number, radius: number, sides: number): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return pts;
}

export function generateStarPoints(cx: number, cy: number, outerR: number, innerR: number, spikes = 5): Vector2[] {
  const pts: Vector2[] = [];
  for (let i = 0; i <= spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return pts;
}

export function generateDiamondPoints(cx: number, cy: number, size: number): Vector2[] {
  return [
    { x: cx, y: cy - size },
    { x: cx + size * 0.7, y: cy },
    { x: cx, y: cy + size },
    { x: cx - size * 0.7, y: cy },
    { x: cx, y: cy - size },
  ];
}

export function generateRectPoints(cx: number, cy: number, w: number, h: number): Vector2[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy - h / 2 },
  ];
}

export function generateScatterPoints(cx: number, cy: number, radius: number, count = 30): Vector2[] {
  const pts: Vector2[] = [];
  // Actual random scatter
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = radius * Math.sqrt(Math.random());
    pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return pts;
}

export function generateArchPoints(cx: number, cy: number, radius: number): Vector2[] {
  // An arch shape: semicircle on top, straight base
  const pts: Vector2[] = [];
  // Semicircle (top)
  for (let i = 0; i <= 32; i++) {
    const angle = Math.PI + (i / 32) * Math.PI;
    pts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  // Legs down
  pts.push({ x: cx + radius, y: cy + radius });
  pts.push({ x: cx + radius * 0.7, y: cy + radius });
  pts.push({ x: cx + radius * 0.7, y: cy });
  // Inner arch
  for (let i = 32; i >= 0; i--) {
    const angle = Math.PI + (i / 32) * Math.PI;
    pts.push({ x: cx + Math.cos(angle) * radius * 0.55, y: cy + Math.sin(angle) * radius * 0.55 });
  }
  pts.push({ x: cx - radius * 0.7, y: cy });
  pts.push({ x: cx - radius * 0.7, y: cy + radius });
  pts.push({ x: cx - radius, y: cy + radius });
  pts.push(pts[0]); // close
  return pts;
}

export function generateShapePoints(shapeType: string, cx: number, cy: number, size = 80): Vector2[] {
  switch (shapeType) {
    case 'circle':         return generateCirclePoints(cx, cy, size);
    case 'pentagon':       return generatePolygonPoints(cx, cy, size, 5);
    case 'hexagon':        return generatePolygonPoints(cx, cy, size, 6);
    case 'change_history': return generatePolygonPoints(cx, cy, size, 3);
    case 'square':         return generateRectPoints(cx, cy, size * 2, size * 2);  // SQR_105 — actual square
    case 'crop_square':    return generateRectPoints(cx, cy, size * 2.2, size * 1.4); // FRAME_108 — wider rect
    case 'star':           return generateStarPoints(cx, cy, size, size * 0.45);
    case 'diamond':        return generateDiamondPoints(cx, cy, size);
    case 'scatter_plot':   return generateScatterPoints(cx, cy, size);
    case 'architecture':   return generateArchPoints(cx, cy, size);
    default:               return generateCirclePoints(cx, cy, size);
  }
}

// ─── Text to points: renders text on a hidden canvas and traces points ──
// The canvas is sized dynamically to fit the text, preventing silent clipping for long strings.
let textCanvasCache: HTMLCanvasElement | null = null;
export function textToPoints(text: string, cx: number, cy: number, fontSize = 48): Vector2[] {
  if (!textCanvasCache) {
    textCanvasCache = document.createElement('canvas');
  }
  const offscreen = textCanvasCache;
  // Measure text width first using a temporary context setup
  const fontStr = `bold ${fontSize}px "Space Grotesk", sans-serif`;
  // Temporarily set font on any 1×1 canvas to measure — context doesn't need to match final size
  offscreen.width = 1;
  offscreen.height = 1;
  const measureCtx = offscreen.getContext('2d', { willReadFrequently: true })!;
  measureCtx.font = fontStr;
  const measured = measureCtx.measureText(text);
  // Pad by 20px each side; height is 2× fontSize to accommodate descenders
  const W = Math.ceil(measured.width) + 40;
  const H = Math.ceil(fontSize * 2) + 20;
  const halfW = Math.floor(W / 2);
  const halfH = Math.floor(H / 2);

  offscreen.width  = W;
  offscreen.height = H;
  const octx = offscreen.getContext('2d', { willReadFrequently: true })!;
  octx.clearRect(0, 0, W, H);
  octx.fillStyle = '#fff';
  octx.font = fontStr;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(text, halfW, halfH);

  const imageData = octx.getImageData(0, 0, W, H);
  const pts: Vector2[] = [];
  const step = 3; // sample every Nth pixel for density
  for (let py = 0; py < H; py += step) {
    for (let px = 0; px < W; px += step) {
      const idx = (py * W + px) * 4;
      if (imageData.data[idx + 3] > 128) {
        pts.push({ x: cx - halfW + px, y: cy - halfH + py });
      }
    }
  }
  return pts;
}

export function computeCentroid(points: Vector2[]): Vector2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) { cx += points[i].x; cy += points[i].y; }
  return { x: cx / points.length, y: cy / points.length };
}

export function computeBounds(points: Vector2[]): StrokeBounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── Point decimation helper (Ramer-Douglas-Peucker) ─────────────
export function perpendicularDistance(pt: Vector2, lineStart: Vector2, lineEnd: Vector2): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  return Math.abs(dx * (lineStart.y - pt.y) - dy * (lineStart.x - pt.x)) / mag;
}

export function decimatePoints(points: Vector2[], epsilon: number): Vector2[] {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = decimatePoints(points.slice(0, maxIdx + 1), epsilon);
    const right = decimatePoints(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}
