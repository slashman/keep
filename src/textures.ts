import * as THREE from 'three';
import type { Project, Floor } from './types';
import { TAG_FAMILY, type TagFamily, genreColor } from './tags';
import { yearText, yearImagePath } from './yearContent';
import { DATA_BASE } from './config';

let maxAniso = 4;
export function setAnisotropy(n: number) { maxAniso = n; }

function tuneTexture<T extends THREE.Texture>(t: T): T {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  // These canvases are non-power-of-two (660×900, 1680×480, …). Mipmap
  // minification (LinearMipmapLinear) needs a full mip chain built from a
  // NPOT source, which Firefox renders blank where Chrome tolerates it.
  // LinearFilter needs no mipmaps and keeps text crisp when read up close.
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wrap text, returning the y after the last drawn line. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines = Infinity,
): number {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (lines + 1 >= maxLines) {
        while (ctx.measureText(line + '…').width > maxW && line.length > 1) line = line.slice(0, -1);
        ctx.fillText(line + '…', x, y);
        return y + lineH;
      }
      ctx.fillText(line, x, y);
      y += lineH;
      lines++;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}

/** A procedurally coloured fallback painting when a project has no / unreachable image. */
export function fallbackPaintingTexture(title: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 512);
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, `hsl(${h}, 45%, 32%)`);
  g.addColorStop(1, `hsl(${(h + 40) % 360}, 40%, 14%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // simple emblem
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(256, 256, i * 40, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 46px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const initials = title.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  ctx.fillText(initials || '?', 256, 256);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** A simple blocky default face (eyes + smile) for an NPC that has no picture. */
export function faceTexture(seed: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  ctx.fillStyle = `hsl(${h}, 42%, 62%)`;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath(); ctx.ellipse(92, 104, 15, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(164, 104, 15, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(128, 150, 46, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/**
 * Load an image and fit it onto a square canvas (so it maps cleanly onto a cube face).
 * By default the square is centre-cropped (cover-fit). If `leftMargin` (0..1) is given,
 * the square is instead the full image height taken from x = width * leftMargin, y = 0 —
 * letting a wide group photo pick out one person's portrait.
 */
export function squareImageTexture(url: string, leftMargin?: number): Promise<THREE.CanvasTexture | null> {
  return loadHTMLImage(url).then((img) => {
    if (!img) return null;
    const { canvas, ctx } = makeCanvas(256, 256);
    if (leftMargin != null) {
      const side = Math.min(img.width, img.height); // a square as tall as the image
      const sx = Math.max(0, Math.min(img.width * leftMargin, img.width - side));
      ctx.drawImage(img, sx, 0, side, side, 0, 0, 256, 256);
    } else {
      drawCover(ctx, img, 0, 0, 256, 256);
    }
    return tuneTexture(new THREE.CanvasTexture(canvas));
  });
}

/** A floating name tag rendered above an NPC. */
export function nameTagTexture(name: string): THREE.CanvasTexture {
  const W = 512, H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.font = 'bold 52px Georgia, serif';
  const tw = Math.min(W - 24, ctx.measureText(name).width + 60);
  ctx.fillStyle = 'rgba(14,12,20,0.82)';
  roundRect(ctx, (W - tw) / 2, 24, tw, 80, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224,178,86,0.7)';
  ctx.lineWidth = 3;
  roundRect(ctx, (W - tw) / 2, 24, tw, 80, 20);
  ctx.stroke();
  ctx.fillStyle = '#f0e7cf';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let t = name;
  while (ctx.measureText(t).width > tw - 40 && t.length > 2) t = t.slice(0, -1);
  ctx.fillText(t === name ? t : t + '…', W / 2, 66);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** Load a project image through the dev proxy; resolves to null on failure. */
export function loadImageTexture(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => resolve(tuneTexture(tex)),
      undefined,
      () => resolve(null),
    );
  });
}

/**
 * Dev days shown on a placard: summed from effortMeasures when present, otherwise
 * derived from the category (games1 → 50, games2 → 20, games3 → 10). Null (shown
 * as nothing) for any other case.
 */
function devDays(p: Project): number | null {
  const em = p.effortMeasures;
  if (em && em.length) return em.reduce((sum, m) => sum + (m.days ?? 0), 0);
  switch (p.categoryId) {
    case 'games1': return 50;
    case 'games2': return 20;
    case 'games3': return 10;
    default: return null;
  }
}

/** The museum wall placard: title, meta, description and colour-coded tag pills. */
export function placardTexture(p: Project): THREE.CanvasTexture {
  const W = 660, H = 900;
  const { canvas, ctx } = makeCanvas(W, H);

  // parchment-dark panel
  ctx.fillStyle = '#14121c';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(224,178,86,0.10)');
  grad.addColorStop(0.15, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(224,178,86,0.5)';
  ctx.lineWidth = 6;
  roundRect(ctx, 10, 10, W - 20, H - 20, 18);
  ctx.stroke();

  const padX = 44;
  let y = 74;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // eyebrow: dev days, plus a "continued" marker on floors where the project was
  // developed but not started
  const dd = devDays(p);
  const eyebrow: string[] = [];
  if (dd != null) eyebrow.push(`${dd} DEV DAYS`);
  if (p.revisited) eyebrow.push('CONTINUED');
  if (eyebrow.length) {
    ctx.fillStyle = '#e0b256';
    ctx.font = 'bold 22px Georgia, serif';
    ctx.fillText(eyebrow.join('   ·   '), padX, y);
    y += 12;
  }

  // title
  ctx.fillStyle = '#f4efe2';
  ctx.font = 'bold 46px Georgia, serif';
  y = wrapText(ctx, p.title, padX, y + 42, W - padX * 2, 50, 2);

  // subtitle
  if (p.subtitle) {
    ctx.fillStyle = '#c9c0a8';
    ctx.font = 'italic 26px Georgia, serif';
    y = wrapText(ctx, p.subtitle, padX, y + 20, W - padX * 2, 32, 2);
  }

  // meta line
  const yearsTxt = p.years?.length ? p.years.join('–') : String(p.year ?? '');
  const meta: string[] = [];
  if (yearsTxt) meta.push(yearsTxt);
  if (p.status) meta.push(cap(p.status));
  if (p.activity) meta.push(cap(p.activity));
  if (p.client) meta.push('for ' + p.client);
  if (p.weeksOfWork) meta.push(`${p.weeksOfWork}w work`);
  ctx.fillStyle = '#9a927e';
  ctx.font = '22px Georgia, serif';
  y = wrapText(ctx, meta.join('   ·   '), padX, y + 34, W - padX * 2, 28, 2);

  // divider
  y += 16;
  ctx.strokeStyle = 'rgba(224,178,86,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
  y += 30;

  // description
  if (p.text) {
    ctx.fillStyle = '#d7d0be';
    ctx.font = '25px Georgia, serif';
    y = wrapText(ctx, p.text, padX, y, W - padX * 2, 33, 7);
  }

  // tag pills, grouped by family
  y += 18;
  const families: TagFamily[] = ['genre', 'technologies', 'collaborators', 'artStyle'];
  ctx.font = 'bold 21px Georgia, serif';
  for (const fam of families) {
    const values = (p[fam] as string[] | undefined)?.filter(Boolean) ?? [];
    if (!values.length) continue;
    const info = TAG_FAMILY[fam];
    // family label
    ctx.fillStyle = info.color;
    ctx.font = 'bold 18px Georgia, serif';
    ctx.fillText(info.label.toUpperCase(), padX, y);
    y += 12;
    // pills row(s)
    let x = padX;
    ctx.font = 'bold 21px Georgia, serif';
    const rowH = 40;
    for (const v of values) {
      const w = ctx.measureText(v).width + 30;
      if (x + w > W - padX) { x = padX; y += rowH; }
      // pill bg
      ctx.fillStyle = hexA(info.color, 0.16);
      roundRect(ctx, x, y, w, 30, 15);
      ctx.fill();
      ctx.strokeStyle = hexA(info.color, 0.65);
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, w, 30, 15);
      ctx.stroke();
      ctx.fillStyle = '#efe9da';
      ctx.fillText(v, x + 15, y + 22);
      x += w + 10;
    }
    y += rowH + 8;
    if (y > H - 60) break;
  }

  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** Small engraved plaque with the project title, mounted under a painting. */
export function titlePlaqueTexture(title: string): THREE.CanvasTexture {
  const W = 640, H = 150;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3a3222');
  g.addColorStop(1, '#241e14');
  ctx.fillStyle = g;
  roundRect(ctx, 6, 6, W - 12, H - 12, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224,178,86,0.6)';
  ctx.lineWidth = 4;
  roundRect(ctx, 6, 6, W - 12, H - 12, 12);
  ctx.stroke();
  ctx.fillStyle = '#e9d9ac';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let t = title;
  while (ctx.measureText(t).width > W - 60 && t.length > 4) t = t.slice(0, -1);
  if (t !== title) t = t.slice(0, -1) + '…';
  ctx.fillText(t, W / 2, H / 2 + 4);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** Hanging banner cloth coloured by the project's primary genre. */
export function bannerTexture(genre: string | undefined, color: string): THREE.CanvasTexture {
  const W = 256, H = 640;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, color);
  g.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // vertical trim
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(20, 0, 8, H);
  ctx.fillRect(W - 28, 0, 8, H);
  // emblem circle
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(W / 2, 120, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 60px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((genre?.[0] ?? '◆').toUpperCase(), W / 2, 122);
  // vertical genre text
  if (genre) {
    ctx.save();
    ctx.translate(W / 2, 360);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 40px Georgia, serif';
    let g2 = genre.toUpperCase();
    if (ctx.measureText(g2).width > 240) { ctx.font = 'bold 30px Georgia, serif'; }
    ctx.fillText(g2, 0, 0);
    ctx.restore();
  }
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** Face label for a lectern button. */
export function buttonLabelTexture(color: string, glyph: string, verb: string, title: string): THREE.CanvasTexture {
  const W = 512, H = 168;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, shade(color, 0.15));
  g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g;
  roundRect(ctx, 4, 4, W - 8, H - 8, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  roundRect(ctx, 4, 4, W - 8, H - 8, 20);
  ctx.stroke();
  ctx.fillStyle = '#0e0a06';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (glyph) { ctx.font = '58px Georgia, serif'; ctx.fillText(glyph, 26, H / 2); }
  const tx = glyph ? 108 : 34;
  ctx.font = 'bold 40px Georgia, serif';
  let t = verb;
  ctx.fillText(t, tx, 58);
  ctx.font = '28px Georgia, serif';
  ctx.fillStyle = 'rgba(14,10,6,0.8)';
  let sub = title;
  while (ctx.measureText(sub).width > W - tx - 30 && sub.length > 3) sub = sub.slice(0, -1);
  if (sub !== title) sub = sub.slice(0, -1) + '…';
  ctx.fillText(sub, tx, 112);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** A carved plaque sign hung above a doorway (e.g. "Smaller Projects"). */
export function doorSignTexture(text: string): THREE.CanvasTexture {
  const W = 768, H = 220;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3a3222');
  g.addColorStop(1, '#241e14');
  ctx.fillStyle = g;
  roundRect(ctx, 8, 8, W - 16, H - 16, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224,178,86,0.7)';
  ctx.lineWidth = 5;
  roundRect(ctx, 8, 8, W - 16, H - 16, 16);
  ctx.stroke();
  ctx.fillStyle = '#e9d9ac';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 74px Georgia, serif';
  let t = text;
  while (ctx.measureText(t).width > W - 150 && t.length > 4) t = t.slice(0, -1);
  ctx.fillText(t, W / 2, H / 2);
  // flanking arrows
  ctx.fillStyle = '#e0b256';
  ctx.font = 'bold 64px Georgia, serif';
  ctx.fillText('❯', W - 70, H / 2 + 2);
  ctx.fillText('❮', 70, H / 2 + 2);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

/** Big directional sign texture for the elevator core. */
export function signTexture(lines: string[]): THREE.CanvasTexture {
  const W = 512, H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#1a1626';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(224,178,86,0.6)';
  ctx.lineWidth = 8;
  roundRect(ctx, 14, 14, W - 28, H - 28, 20);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e0b256';
  ctx.font = '110px serif';
  ctx.fillText('🛗', W / 2, 150);
  ctx.fillStyle = '#f4efe2';
  ctx.font = 'bold 46px Georgia, serif';
  let y = 280;
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += 60; }
  ctx.fillStyle = '#9a927e';
  ctx.font = '26px Georgia, serif';
  ctx.fillText('press  E  to travel', W / 2, H - 54);
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

function resolveImg(image?: string): string | null {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  return DATA_BASE + image.replace(/^\//, '');
}
function loadHTMLImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    // Request CORS so drawing the image onto a canvas doesn't taint it — a
    // tainted canvas throws SecurityError when uploaded as a WebGL texture.
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height;
  const r = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ir > r) { sw = img.height * r; sx = (img.width - sw) / 2; }
  else { sh = img.width / r; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * The floor's grand tapestry. Prefers the real per-year image from slashie.net
 * (img/years/YYYY.jpg, loaded live via the proxy); if that year has none, it
 * falls back to a montage of the year's project images, then to a woven pattern.
 * The year is always emblazoned huge over the top.
 */
export function yearTapestryTexture(floor: Floor): THREE.CanvasTexture {
  const W = 1280, H = 800;
  const { canvas, ctx } = makeCanvas(W, H);
  const base = genreColor(dominant(floor.projects, 'genre')) || `hsl(${(floor.year * 47) % 360},45%,45%)`;

  const fillWeave = () => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(base, 0.05));
    g.addColorStop(1, shade(base, -0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < H; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  };
  const fillYearImage = (img: HTMLImageElement) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawCover(ctx, img, 0, 0, W, H);
    // gentle vignette so the border and year read cleanly
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(4,3,9,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  };
  const fillMontage = (images: HTMLImageElement[]) => {
    ctx.fillStyle = shade(base, -0.45);
    ctx.fillRect(0, 0, W, H);
    const cols = Math.ceil(Math.sqrt(images.length));
    const cw = W / cols, ch = H / Math.ceil(images.length / cols);
    images.forEach((img, i) => drawCover(ctx, img, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch));
    ctx.fillStyle = hexA(base, 0.38); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,6,14,0.32)'; ctx.fillRect(0, 0, W, H);
  };

  const overlay = () => {
    // ornate border
    ctx.strokeStyle = '#e0b256';
    ctx.lineWidth = 16;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(224,178,86,0.55)';
    ctx.strokeRect(44, 44, W - 88, H - 88);
    // dark band behind the year for legibility
    const bandH = 300;
    const band = ctx.createLinearGradient(0, H / 2 - bandH / 2, 0, H / 2 + bandH / 2);
    band.addColorStop(0, 'rgba(8,6,14,0)');
    band.addColorStop(0.5, 'rgba(8,6,14,0.66)');
    band.addColorStop(1, 'rgba(8,6,14,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, H / 2 - bandH / 2, W, bandH);
    // the year, huge
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e9d9ac';
    ctx.font = '46px Georgia, serif';
    ctx.fillText('· ANNO ·', W / 2, H / 2 - 130);
    ctx.font = 'bold 300px Georgia, serif';
    ctx.shadowColor = 'rgba(224,178,86,0.6)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#f4efe2';
    ctx.fillText(String(floor.year), W / 2, H / 2 + 20);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#e0b256';
    ctx.font = 'italic 40px Georgia, serif';
    ctx.fillText(`${floor.projects.length} works of the Keep`, W / 2, H / 2 + 175);
  };

  fillWeave();
  overlay();
  const tex = tuneTexture(new THREE.CanvasTexture(canvas));

  (async () => {
    // 1) the real per-year image
    const yUrl = yearImagePath(floor.year);
    if (yUrl) {
      const im = await loadHTMLImage(yUrl);
      if (im) { fillYearImage(im); overlay(); tex.needsUpdate = true; return; }
    }
    // 2) montage of the year's project images
    const urls = floor.projects.map((p) => resolveImg(p.image)).filter(Boolean).slice(0, 16) as string[];
    if (urls.length) {
      const imgs = (await Promise.all(urls.map(loadHTMLImage))).filter(Boolean) as HTMLImageElement[];
      if (imgs.length) { fillMontage(imgs); overlay(); tex.needsUpdate = true; }
    }
  })();

  return tex;
}

/** The chronicle panel: a wide, short summary of the floor's year (two columns). */
export function yearInfoTexture(floor: Floor): THREE.CanvasTexture {
  const W = 1680, H = 480;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#14121c';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(224,178,86,0.5)';
  ctx.lineWidth = 6;
  roundRect(ctx, 10, 10, W - 20, H - 20, 16);
  ctx.stroke();

  const padX = 52;
  const colGap = 60;
  const leftW = 980;
  const rightX = padX + leftW + colGap;
  const rightW = W - rightX - padX;
  // divider
  ctx.strokeStyle = 'rgba(224,178,86,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(rightX - colGap / 2, 40); ctx.lineTo(rightX - colGap / 2, H - 40); ctx.stroke();

  // ---- left column: title + description + project list ----
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0b256';
  ctx.font = 'bold 38px Georgia, serif';
  ctx.fillText(`The Chronicle of ${floor.year}`, padX, 62);

  const desc = yearText(floor.year);
  let y = 100;
  if (desc) {
    ctx.fillStyle = '#e9e1cb';
    ctx.font = 'italic 28px Georgia, serif';
    y = wrapText(ctx, '“' + desc + '”', padX, y, leftW, 37, 4) + 10;
  }
  const started = floor.projects.filter((p) => !p.revisited);
  const continued = floor.projects.filter((p) => p.revisited);
  ctx.fillStyle = '#a49d89';
  ctx.font = '23px Georgia, serif';
  const begun = `${started.length} work${started.length === 1 ? '' : 's'} begun here`
    + (started.length ? ': ' + started.map((p) => p.title).join(' · ') + '.' : '.');
  y = wrapText(ctx, begun, padX, y + 6, leftW, 30, 2) + 8;
  if (continued.length) {
    ctx.fillStyle = '#8f8874';
    ctx.font = 'italic 22px Georgia, serif';
    wrapText(ctx, 'Also worked on this year: ' + continued.map((p) => p.title).join(' · ') + '.', padX, y, leftW, 29, 2);
  }

  // ---- right column: aggregated tag families ----
  ctx.fillStyle = '#c9c0a8';
  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillText('WOVEN INTO THIS YEAR', rightX, 62);
  let ry = 104;
  const fams: TagFamily[] = ['genre', 'technologies', 'collaborators', 'artStyle'];
  for (const fam of fams) {
    const top = topCounts(floor.projects, fam, 10);
    if (!top.length) continue;
    const info = TAG_FAMILY[fam];
    ctx.fillStyle = info.color;
    ctx.font = 'bold 22px Georgia, serif';
    ctx.fillText(info.label.toUpperCase(), rightX, ry);
    ry += 30;
    ctx.fillStyle = '#efe9da';
    ctx.font = '23px Georgia, serif';
    ry = wrapText(ctx, top.join(',  '), rightX, ry, rightW, 29, 2) + 14;
    if (ry > H - 40) break;
  }
  return tuneTexture(new THREE.CanvasTexture(canvas));
}

function dominant(projects: Project[], field: 'genre'): string | undefined {
  return topCounts(projects, field, 1)[0];
}
function topCounts(projects: Project[], field: TagFamily, n: number): string[] {
  const counts = new Map<string, number>();
  for (const p of projects) {
    for (const v of (p[field] as string[] | undefined) ?? []) {
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}

// ---------- small colour helpers ----------
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function shade(hex: string, amt: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}
function hexA(hex: string, a: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '');
  if (m.length === 6) {
    return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
  }
  // fall back for hsl()/rgb() inputs — draw them onto a 1px canvas to resolve
  const { ctx } = makeCanvas(1, 1);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}
