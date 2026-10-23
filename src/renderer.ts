/** Adapted from stackedlol/ascii-sharks. See LICENSE.md and THIRD_PARTY_NOTICES.md. */
/**
 * Draws the World as a grid of ASCII cells:
 *   1. a pure black cell grid
 *   2. a wake field that diffuses where things swim, lighting the dots cyan
 *   3. fish as minimal ASCII dashes, one per cell, glinting on hard turns
 *   4. sharks rasterised cell-by-cell with supersampled edges: grey blocks
 *      shaded by the light, dense glyphs, and shimmering accent colours
 */
import { clamp, hash3, smoothstep } from "./math";
import { SHARK_NODES, type Shark, type SharkKind, type World } from "./world";

export type RenderMode = "ascii" | "type" | "braille" | "blocks" | "geometry" | "lines" | "hanzi";

// Unicode Braille: left column bits 1,2,3,7; right column bits 4,5,6,8.
const BRAILLE_DOTS = [
  [0.27, 0.13, 1], [0.27, 0.37, 2], [0.27, 0.63, 4], [0.27, 0.87, 64],
  [0.73, 0.13, 8], [0.73, 0.37, 16], [0.73, 0.63, 32], [0.73, 0.87, 128],
] as const;
const DOT_THRESHOLDS = [0.06, 0.55, 0.31, 0.8, 0.68, 0.18, 0.93, 0.43];

const ALPHA_LEVELS = 6;
const FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];

// Dot colour classes: blue, green, red, pale; the last entry is the cyan wake.
const DOT_RGB: [number, number, number][] = [
  [48, 52, 235],
  [52, 205, 60],
  [228, 50, 44],
  [190, 212, 255],
  [110, 230, 255],
];
const DOT_BASE_ALPHA = [1, 1, 1, 1, 1];
const WAKE = DOT_RGB.length - 1;

const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
const NIGHT_ACCENTS = ["#b2bfa9", "#c2b2ac", "#a79fbd", "#79bec5", "#8db3a8", "#8aabd0", "#bfba99"];

// Sparse glyphs on bright skin, dense glyphs in shadow, so the texture
// reinforces the shading instead of fighting it.
const SKIN_RAMP = ":;t%SX8#@";
const FIN_GLYPHS = "%;tS:";
const RIDGE_GLYPHS = "@8%";
const EDGE_HEAVY = ":;";
const EDGE_LIGHT = ".',`";


const FLAG_BODY = 1;
const FLAG_EDGE = 2;
const FLAG_FIN = 3;
const FLAG_RIDGE = 4;
const FLAG_EYE = 5;
/** Dark skin markings: tiger bars, zebra-shark spots. */
const FLAG_MARK = 6;
const FLAG_TAIL = 7;
const MARK_GLYPHS = "#%@";
// Increasing ink density, using the reference's uppercase letters and punctuation.
const TYPE_GLYPHS = [".", ":", "-=", "+*", "TA", "ER", "%", "#@"];

// Sub-cell sample offsets for anti-aliased silhouettes.
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

/** Classic top-down half-width at s ∈ [0, 1] (snout → tail), as a fraction of length. */
function classicHalfWidth(s: number) {
  if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
  if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
  const k = (s - 0.84) / 0.16;
  return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

/** Body outline and fin layout per species. All values are fractions of length. */
interface SharkShape {
  halfWidth: (s: number) => number;
  /** Pectoral fin: leading root, trailing root, tip position along the body, and reach. */
  pectoral: [number, number, number, number];
  /** Notched (falcate) trailing edge on the pectorals. */
  falcate: boolean;
  /** Pelvic fins: leading root, trailing root, tip, reach. */
  pelvic: [number, number, number, number];
  /** Forked caudal fin reach, or 0 when the tail is a ribbon (zebra shark). */
  caudal: number;
  dorsal: [number, number];
  secondDorsal: [number, number];
  /**
   * Hammerheads' cephalofoil: half-span, how far its tips sweep back, its depth, and the
   * notch in the middle of the front edge. All fractions of length; absent for other sharks.
   */
  head?: { span: number; sweep: number; depth: number; notch: number };
  /** null when the eyes sit somewhere else (hammerhead: on the cephalofoil tips). */
  eye: [number, number] | null;
  gills: [number, number];
  /** Skin colour multipliers (r, g, b). */
  tint: [number, number, number];
}

const SHAPES: Record<SharkKind, SharkShape> = {
  classic: {
    halfWidth: classicHalfWidth,
    pectoral: [0.15, 0.43, 0.55, 0.26],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.085,
    dorsal: [0.33, 0.47],
    secondDorsal: [0.71, 0.76],
    eye: [0.1, 0.14],
    gills: [0.19, 0.29],
    tint: [0.92, 0.97, 1.05],
  },
  // Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),
  // tall first dorsal, long upper tail lobe. Bronze-olive grey.
  hammerhead: {
    halfWidth: (s) => {
      if (s < 0.06) return 0.045;
      if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
      return classicHalfWidth(s) * 0.92;
    },
    head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
    pectoral: [0.17, 0.4, 0.5, 0.22],
    falcate: true,
    pelvic: [0.56, 0.63, 0.67, 0.075],
    caudal: 0.11,
    dorsal: [0.28, 0.44],
    secondDorsal: [0.7, 0.74],
    eye: null,
    gills: [0.16, 0.26],
    tint: [0.96, 0.98, 0.9],
  },
  // Blunt, square snout on a heavy body; barred back. Warm grey-brown.
  tiger: {
    halfWidth: (s) => {
      if (s < 0.13) return 0.1 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.45);
      if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
      const k = (s - 0.84) / 0.16;
      return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.15, 0.42, 0.53, 0.25],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.095,
    dorsal: [0.33, 0.46],
    secondDorsal: [0.71, 0.75],
    eye: [0.08, 0.12],
    gills: [0.19, 0.28],
    tint: [1.02, 0.95, 0.84],
  },
  // Short rounded head, body done by half-length, then a long ribbon of a
  // tail fin. Broad rounded pectorals, spotted sandy skin.
  zebra: {
    halfWidth: (s) => {
      if (s < 0.1) return 0.075 * Math.pow(Math.sin(((s / 0.1) * Math.PI) / 2), 0.7);
      if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
      if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
      const k = (s - 0.55) / 0.45;
      return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
    },
    pectoral: [0.12, 0.3, 0.36, 0.19],
    falcate: false,
    pelvic: [0.42, 0.48, 0.51, 0.065],
    caudal: 0,
    dorsal: [0.36, 0.44],
    secondDorsal: [0.49, 0.53],
    eye: [0.06, 0.09],
    gills: [0.13, 0.2],
    tint: [1.08, 0.97, 0.74],
  },
  // Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch at the centre,
  // a towering sickle first dorsal (drawn long and bright from above), and a cooler slate skin.
  greathammer: {
    halfWidth: (s) => {
      if (s < 0.05) return 0.04;
      if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
      return classicHalfWidth(s) * 0.95;
    },
    head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
    pectoral: [0.16, 0.38, 0.49, 0.24],
    falcate: true,
    pelvic: [0.55, 0.62, 0.67, 0.085],
    caudal: 0.13,
    dorsal: [0.24, 0.45],
    secondDorsal: [0.68, 0.74],
    eye: null,
    gills: [0.15, 0.25],
    tint: [0.86, 0.93, 1.02],
  },
  // Shortfin mako: a long conical snout, a torpedo body that narrows hard to the tail stalk,
  // and a tall crescent tail. Metallic indigo back.
  mako: {
    halfWidth: (s) => {
      if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5);
      if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
      if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
      const k = (s - 0.86) / 0.14;
      return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
    },
    pectoral: [0.18, 0.4, 0.5, 0.21],
    falcate: true,
    pelvic: [0.58, 0.64, 0.68, 0.06],
    caudal: 0.13,
    dorsal: [0.34, 0.45],
    secondDorsal: [0.76, 0.79],
    eye: [0.11, 0.15],
    gills: [0.2, 0.3],
    tint: [0.78, 0.9, 1.2],
  },
  // Thresher: a compact body over the front half, then the upper tail lobe as a long whip
  // that's as long as the shark itself. Big eyes, long sickle pectorals, bronze-violet skin.
  thresher: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75);
      if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
      if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
      // The whip: thin, with a slight sickle swell before it tapers out.
      const k = (s - 0.48) / 0.52;
      return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002;
    },
    pectoral: [0.12, 0.27, 0.36, 0.2],
    falcate: true,
    pelvic: [0.37, 0.41, 0.44, 0.045],
    caudal: 0,
    dorsal: [0.24, 0.32],
    secondDorsal: [0.45, 0.47],
    eye: [0.05, 0.1],
    gills: [0.11, 0.18],
    tint: [1.0, 0.9, 1.08],
  },
  // Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals set far back,
  // rounded paddle pectorals, and a long low tail with no lower lobe. Tawny brown.
  nurse: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.085 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.4);
      if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
      if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
      const k = (s - 0.72) / 0.28;
      return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
    },
    pectoral: [0.16, 0.34, 0.4, 0.17],
    falcate: false,
    pelvic: [0.45, 0.52, 0.55, 0.075],
    caudal: 0,
    dorsal: [0.5, 0.58],
    secondDorsal: [0.63, 0.69],
    eye: [0.05, 0.075],
    gills: [0.14, 0.22],
    tint: [1.1, 0.96, 0.76],
  },
  // A manta's curved disc, cephalic lobes and pale dorsal patches are sampled separately.
  manta: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.06 + 0.025 * smoothstep(0, 0.08, s);
      if (s < 0.48) return 0.018 + 0.075 * Math.sin(((s - 0.08) / 0.4) * Math.PI);
      return 0.008 * (1 - (s - 0.48) / 0.52) + 0.002;
    },
    pectoral: [0.045, 0.56, 0.3, 0.6],
    falcate: false,
    pelvic: [0.4, 0.5, 0.52, 0.055],
    caudal: 0,
    dorsal: [2, 2], secondDorsal: [2, 2],
    eye: [0.065, 0.14], gills: [2, 2],
    tint: [0.85, 0.96, 1.04],
  },
  // A broad, blunt head, a heavy torso and regularly spaced skin spots.
  whaleshark: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.105 + 0.027 * smoothstep(0, 0.08, s);
      if (s < 0.32) return 0.132;
      if (s < 0.86) return 0.018 + 0.114 * Math.pow(1 - (s - 0.32) / 0.54, 1.1);
      return 0.018 * (1 - (s - 0.86) / 0.14) + 0.003;
    },
    pectoral: [0.18, 0.45, 0.56, 0.24], falcate: false,
    pelvic: [0.61, 0.7, 0.75, 0.09], caudal: 0.12,
    dorsal: [0.39, 0.48], secondDorsal: [0.73, 0.77],
    eye: [0.025, 0.09], gills: [0.16, 0.29],
    tint: [0.72, 0.94, 1.16],
  },
  // A rounded, short body with opposing tall fins and a small scalloped tail.
  sunfish: {
    halfWidth: (s) => {
      if (s < 0.12) return 0.06 + 0.095 * smoothstep(0, 0.12, s);
      if (s < 0.76) return 0.075 + 0.14 * Math.pow(Math.sin(((s - 0.12) / 0.64) * Math.PI), 0.8);
      return 0.065 * (1 - (s - 0.76) / 0.24) + 0.018;
    },
    pectoral: [0.15, 0.28, 0.33, 0.18], falcate: false,
    pelvic: [0.4, 0.78, 0.66, 0.34], caudal: 0.045,
    dorsal: [0.42, 0.7], secondDorsal: [2, 2],
    eye: [0.055, 0.14], gills: [0.16, 0.21],
    tint: [0.99, 1.02, 0.88],
  },
};

const KINDS = Object.keys(SHAPES) as SharkKind[];

function inTriangle(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Visible dark-grey cell grid, snapped to device pixels. Shared with the sidebar backdrop. */
export function paintGrid(g: CanvasRenderingContext2D, W: number, H: number, cw: number, ch: number, dpr: number, dark = false) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = dark ? "rgba(133,183,202,0.035)" : "rgba(255,255,255,0.055)";
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c <= Math.ceil(W / cw); c++) {
    const x = Math.round(c * cw * dpr) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, H * dpr);
  }
  for (let r = 0; r <= Math.ceil(H / ch); r++) {
    const y = Math.round(r * ch * dpr) + 0.5;
    g.moveTo(0, y);
    g.lineTo(W * dpr, y);
  }
  g.stroke();
}

export class AsciiRenderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private cw = 12;
  private ch = 18;
  private cols = 0;
  private rows = 0;
  private fontFamily = "ui-monospace, Menlo, monospace";
  private mode: RenderMode = "ascii";
  private dark = false;

  private dotKind = new Uint8Array(0); // 0 none, 1 blue, 2 green, 3 red, 4 pale
  private dotPhase = new Float32Array(0);
  private dotFreq = new Float32Array(0);
  private energy = new Float32Array(0);
  private energyTmp = new Float32Array(0);
  private heat = new Float32Array(0);
  private bucketOf = new Uint8Array(0);
  private bucketOrder = new Int32Array(0);
  private bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
  private dotStyles: string[] = [];

  private sharkFlag = new Uint8Array(0);
  private sharkShade = new Float32Array(0);
  private sharkKey = new Uint32Array(0);
  private sharkDepth = new Float32Array(0);
  private sharkKind = new Uint8Array(0);
  private sharkDots = new Uint8Array(0);
  private sharkAngle = new Float32Array(0);
  /** Cells darkened by a shark's shadow on the seabed. */
  private sharkShadow = new Uint8Array(0);
  private spine = new Float32Array(SHARK_NODES * 2);
  private arc = new Float32Array(SHARK_NODES);
  private arcTotal = 1;
  private shape = SHAPES.classic;
  private sharkId = 0;
  private finTipLeft = 0;
  private finTipRight = 0;
  // Scratch outputs of sampleShark(), to avoid allocating per sample.
  private hitFlag = 0;
  private hitShade = 0;
  private hitS = 0;
  private hitV = 0;
  private hitDist = 0;
  private hitAngle = 0;

  /** Cells holding a fish this frame (frame stamp); dots skip them. */
  private fishStamp = new Uint32Array(0);
  private frameId = 0;
  /** Fish cells bucketed by brightness, so each bucket is one fillStyle. */
  private fishBuckets: number[][] = FISH_ALPHAS.map(() => []);
  private fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");

    for (let c = 0; c < DOT_RGB.length; c++) {
      const [r, g, b] = DOT_RGB[c];
      for (let l = 0; l < ALPHA_LEVELS; l++) {
        const a = (DOT_BASE_ALPHA[c] * (l + 1)) / ALPHA_LEVELS;
        this.dotStyles.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
      }
    }
  }

  get cellWidth() {
    return this.cw;
  }

  get cellHeight() {
    return this.ch;
  }

  setFontFamily(family: string) {
    if (family) this.fontFamily = family;
  }

  setMode(mode: RenderMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.paintBackground();
  }

  setTheme(dark: boolean) {
    this.dark = dark;
    this.fishStyles = FISH_ALPHAS.map(a => dark
      ? `rgba(139,182,196,${a * 0.85})`
      : `rgba(230,238,255,${a})`);
    this.paintBackground();
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124), 8, 13);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;

    const n = this.cols * this.rows;
    this.dotKind = new Uint8Array(n);
    this.dotPhase = new Float32Array(n);
    this.dotFreq = new Float32Array(n);
    this.energy = new Float32Array(n);
    this.energyTmp = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.bucketOf = new Uint8Array(n);
    this.bucketOrder = new Int32Array(n);
    this.sharkFlag = new Uint8Array(n);
    this.sharkShade = new Float32Array(n);
    this.sharkKey = new Uint32Array(n);
    this.sharkDepth = new Float32Array(n);
    this.sharkKind = new Uint8Array(n);
    this.sharkDots = new Uint8Array(n);
    this.sharkAngle = new Float32Array(n);
    this.sharkShadow = new Uint8Array(n);
    this.fishStamp = new Uint32Array(n);

    for (let i = 0; i < n; i++) {
      const col = i % this.cols;
      const row = (i / this.cols) | 0;
      // No ambient dots: the grid stays black. Only the cyan wake lights cells.
      this.dotKind[i] = 0;
      this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
      this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
    }
    this.paintBackground();
  }

  private paintBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    const { width: W, height: H, dpr, cw, ch } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.dark) {
      const water = g.createRadialGradient(W * 0.5, H * 0.49, 0, W * 0.5, H * 0.49, Math.hypot(W, H) * 0.62);
      water.addColorStop(0, "#10252f");
      water.addColorStop(0.48, "#0b1923");
      water.addColorStop(1, "#07111a");
      g.fillStyle = water;
    } else {
      g.fillStyle = "#000";
    }
    g.fillRect(0, 0, W, H);
    if (this.mode !== "type") paintGrid(g, W, H, cw, ch, dpr, this.dark);
  }

  render(world: World, dt: number) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    const t = world.time;

    this.consumeEvents(world);
    this.rasterizeSharks(world.sharks, t);
    this.depositWake(world);
    this.diffuse(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    this.markFish(world);
    this.drawDots(t);

    this.drawHeat();
    this.drawFish();
    this.drawSharks(t);
  }

  // ── simulation → field ──────────────────────────────────────────────

  private cellIndex(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private stamp(field: Float32Array, x: number, y: number, radius: number, amount: number) {
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }

  private consumeEvents(world: World) {
    for (const e of world.events) {
      if (e.kind === "eat") {
        this.stamp(this.heat, e.x, e.y, 2, 1);
        this.stamp(this.energy, e.x, e.y, 3, 0.9);
      } else {
        this.stamp(this.energy, e.x, e.y, 6, 1.4);
      }
    }
    world.events.length = 0;
  }

  private depositWake(world: World) {
    const { energy } = this;
    for (const f of world.fish) {
      if (!f.alive) continue;
      const i = this.cellIndex(f.x, f.y);
      if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
    }
    for (const sh of world.sharks) {
      // The tail sweeps the most water.
      for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
        const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 0.0012);
      }
    }
    if (world.pointer.active) {
      this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
    }
  }

  /** Blur + decay so wakes spread out like ripples and fade. */
  private diffuse(dt: number) {
    const { cols, rows, energy, energyTmp: tmp, heat } = this;
    const decay = Math.exp(-dt * 1.5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1] : energy[i];
        const rt = c < cols - 1 ? energy[i + 1] : energy[i];
        const u = r > 0 ? energy[i - cols] : energy[i];
        const d = r < rows - 1 ? energy[i + cols] : energy[i];
        tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
    const heatDecay = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
  }

  // ── sharks ──────────────────────────────────────────────────────────

  /**
   * Classify one point against the current shark (spine/arc already built).
   * Body coordinates: s along the spine (0 snout → 1 tail), v across it.
   * Writes hit* fields and returns whether the point is on the shark.
   */
  private sampleShark(px: number, py: number, L: number) {
    if (this.shape === SHAPES.manta) return this.sampleManta(px, py, L);
    const { spine, arc } = this;
    const N = SHARK_NODES;
    let best = Infinity;
    let bestS = 0;
    let bestSign = 1;
    let bestNx = 0;
    let bestNy = 0;
    for (let k = 0; k < N - 1; k++) {
      const ax = spine[k * 2];
      const ay = spine[k * 2 + 1];
      const sx = spine[(k + 1) * 2] - ax;
      const sy = spine[(k + 1) * 2 + 1] - ay;
      const len2 = sx * sx + sy * sy || 1;
      const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
      const qx = ax + sx * u;
      const qy = ay + sy * u;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bestS = (arc[k] + u * len) / this.arcTotal;
        bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
        bestNx = (-sy / len) * bestSign;
        bestNy = (sx / len) * bestSign;
        this.hitAngle = Math.atan2(sy, sx);
      }
    }

    const a = Math.sqrt(best);
    const s = bestS;
    const u = s * L;
    const shape = this.shape;
    const w = shape.halfWidth(s) * L;
    this.hitDist = a;
    this.hitS = s;
    this.hitV = a * bestSign;

    const head = this.shape.head;
    if (head && u < L * (head.sweep + head.depth + head.notch)) {
      // Cephalofoil: a wide wing across the snout, its tips swept back toward the eyes,
      // and on a great hammerhead a shallow notch in the middle of the front edge.
      const span = L * head.span;
      const r = a / span;
      const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
      // Full depth almost to the tips, so the wing reads as a solid bar rather than a thin line.
      const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
      if (r <= 1 && u >= front && u <= front + depth) {
        this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
        this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
        return true;
      }
    }

    if (a <= w) {
      const across = a / (w || 1);
      // Rounded back lit from the top-left; flanks fall off into shadow.
      const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
      let shade = 0.58 - across * across * 0.42 + facing * 0.26;
      let flag = FLAG_BODY;
      if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
        // First dorsal fin, catching the light.
        flag = FLAG_RIDGE;
        shade = 1;
      } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
        shade = Math.max(shade, 0.82);
      } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
        flag = FLAG_EYE;
        shade = 0;
      } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
        // Five gill slits.
        if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
      } else if (s < 0.05) {
        // Pale snout tip.
        shade = Math.max(shade, 0.7);
      } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
        // Zebra sharks carry pale ridges down the back.
        shade = Math.max(shade, 0.8);
      } else if (this.marked(s, a * bestSign, L, across)) {
        flag = FLAG_MARK;
      }
      this.hitFlag = flag;
      this.hitShade = shade;
      return true;
    }

    const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
    const [p0, p1, p2] = shape.pectoral;
    if (
      inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) &&
      // Falcate (sickle) fins get a concave trailing edge.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))
    ) {
      this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
      this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
      return true;
    }
    const [v0, v1, v2, vr] = shape.pelvic;
    if (
      inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) ||
      // Forked caudal fin.
      (shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
    ) {
      this.hitFlag = FLAG_FIN;
      this.hitShade = 0.36;
      return true;
    }
    return false;
  }

  /** Broad, curved manta disc in a stable frame; the whip follows the flexible spine. */
  private sampleManta(px: number, py: number, L: number) {
    const { spine } = this;
    const dx = spine[20] - spine[0];
    const dy = spine[21] - spine[1];
    const axisLength = Math.hypot(dx, dy) || 1;
    const tx = dx / axisLength;
    const ty = dy / axisLength;
    const localLength = axisLength * (SHARK_NODES - 1) / 10;
    const x = px - spine[0];
    const y = py - spine[1];
    const s = (x * tx + y * ty) / localLength;
    const v = -x * ty + y * tx;
    const a = Math.abs(v) / localLength;
    const reach = (v > 0 ? this.finTipRight : this.finTipLeft) / L;
    const q = a / reach;
    this.hitS = s;
    this.hitV = v;
    this.hitDist = Math.abs(v);
    this.hitAngle = Math.atan2(ty, tx);
    this.hitFlag = FLAG_BODY;
    this.hitShade = 0.2;

    // Rolled cephalic fins extend ahead of the shallow, concave mouth.
    const lobeCentre = 0.075 + 0.12 * Math.max(0, s);
    if (s >= -0.045 && s <= 0.065) {
      const lobeWidth = 0.009 + 0.009 * smoothstep(-0.045, 0.05, s);
      if (Math.abs(a - lobeCentre) < lobeWidth * Math.sqrt(Math.max(0, 1 - ((s - 0.01) / 0.055) ** 2))) {
        this.hitFlag = s < 0 ? FLAG_RIDGE : FLAG_BODY;
        this.hitShade = s < 0 ? 0.95 : 0.36;
        return true;
      }
    }

    // Swept leading margins meet concave trailing margins at tapered wing tips.
    const front = 0.022 + 0.278 * Math.pow(q, 1.45) + 0.016 * Math.exp(-q * q / 0.012);
    const back = 0.56 - 0.25 * Math.pow(q, 0.7);
    if (q <= 1 && s >= front && s <= back) {
      const shoulder = ((a - 0.112) / 0.05) ** 2 + ((s - 0.092 - (a - 0.112) * 0.7) / 0.025) ** 2;
      const wingBand = front + 0.025 + 0.025 * Math.sin(q * Math.PI);
      const paleWing = q > 0.42 && Math.abs(s - wingBand) < 0.009 + 0.013 * smoothstep(0.65, 1, q);
      const rearRidge = Math.abs(a - (0.56 - s) * 0.25) < 0.008 && s > 0.29;
      const mouthRim = a < 0.08 && s - front < 0.008;
      this.hitShade = 0.16 + 0.15 * (1 - q) + 0.08 * Math.sin((s - front) / (back - front) * Math.PI);
      if (shoulder < 1 || paleWing || rearRidge || mouthRim) {
        this.hitFlag = FLAG_RIDGE;
        this.hitShade = 0.9 + 0.1 * (1 - Math.min(1, shoulder));
      } else if (s > 0.05 && s < 0.09 && a > 0.09 && a < 0.115) {
        this.hitFlag = FLAG_EYE;
        this.hitShade = 0;
      }
      return true;
    }

    // A continuous narrow whip, rather than the previous broad ribbon tail.
    if (s > 0.48) {
      for (let k = 10; k < SHARK_NODES - 1; k++) {
        const ax = spine[k * 2];
        const ay = spine[k * 2 + 1];
        const sx = spine[k * 2 + 2] - ax;
        const sy = spine[k * 2 + 3] - ay;
        const len2 = sx * sx + sy * sy || 1;
        const along = ((px - ax) * sx + (py - ay) * sy) / len2;
        if (along < 0 || along > 1) continue;
        const distance = Math.hypot(px - ax - sx * along, py - ay - sy * along);
        const tailS = (k + along) / (SHARK_NODES - 1);
        const width = Math.max(this.cw * 0.22, L * (0.0045 - tailS * 0.0025));
        if (distance <= width) {
          this.hitS = tailS;
          this.hitV = distance;
          this.hitFlag = FLAG_TAIL;
          this.hitShade = 0.76;
          this.hitAngle = Math.atan2(sy, sx);
          return true;
        }
      }
    }
    return false;
  }

  /** Whether a body point (s along, v across) falls on a dark marking. */
  private marked(s: number, v: number, L: number, across: number) {
    if (this.shape === SHAPES.whaleshark) {
      if (s < 0.1 || s > 0.81) return false;
      const u = s / 0.052;
      const w = v / (L * 0.043);
      const x = u - Math.floor(u) - 0.5;
      const y = w - Math.floor(w) - 0.5;
      return x * x + y * y < 0.075;
    }
    if (this.shape === SHAPES.tiger) {
      // Wavy vertical bars over the back half, fading out toward the head.
      if (s < 0.2 || s > 0.9 || across > 0.85) return false;
      const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
      const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
      return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
    }
    if (this.shape === SHAPES.zebra) {
      // Leopard spots on a jittered grid, so they ride along with the skin.
      if (s < 0.07) return false;
      const gu = (s * L) / (L * 0.06);
      const gv = v / (L * 0.045);
      const cu = Math.floor(gu);
      const cv = Math.floor(gv);
      const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
      const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
      return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
    }
    return false;
  }

  /**
   * Build a smooth, undulating render spine from the sim spine, then
   * supersample every cell in the shark's bounding box against the shape.
   * Fully covered cells become solid skin; partial cells become edge glyphs.
   */
  private rasterizeSharks(sharks: Shark[], t: number) {
    const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;
    sharkFlag.fill(0);
    sharkShadow.fill(0);
    this.sharkDots.fill(0);

    for (const sh of sharks) {
      const L = sh.length;
      const N = SHARK_NODES;
      const n = sh.nodes;
      const swim = clamp(sh.speed / 60, 0.4, 1.4);
      this.shape = SHAPES[sh.kind];
      this.sharkId = sh.id;
      const kindIndex = KINDS.indexOf(sh.kind);

      // Travelling body wave, growing toward the tail.
      for (let k = 0; k < N; k++) {
        const s = k / (N - 1);
        if (sh.kind === "manta") {
          // The disc glides as a single surface; only the whip bends, gently.
          const hx = n[0] - n[2];
          const hy = n[1] - n[3];
          const hl = Math.hypot(hx, hy) || 1;
          const tail = smoothstep(0.45, 1, s);
          const bend = L * tail * tail * (0.018 * Math.sin(sh.phase * 0.65 - s * 2.4) + 0.07 * clamp(sh.turn, -1, 1));
          spine[k * 2] = n[0] - hx / hl * L * s - hy / hl * bend;
          spine[k * 2 + 1] = n[1] - hy / hl * L * s + hx / hl * bend;
          continue;
        }
        const a = Math.max(0, k - 1);
        const b = Math.min(N - 1, k + 1);
        let tx = n[a * 2] - n[b * 2];
        let ty = n[a * 2 + 1] - n[b * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const flexScale = sh.kind === "sunfish" ? 0.12 : sh.kind === "whaleshark" ? 0.65 : 1;
        const amp = L * 0.05 * flexScale * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
        const off = amp * Math.sin(sh.phase - s * 5.2);
        spine[k * 2] = n[k * 2] - ty * off;
        spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
      }
      arc[0] = 0;
      for (let k = 1; k < N; k++) {
        arc[k] =
          arc[k - 1] +
          Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
      }
      this.arcTotal = arc[N - 1] || 1;

      // Bank into turns: the inside fin foreshortens, the outside one spreads.
      const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
      const flex = sh.kind === "manta"
        ? 0.84 + 0.16 * Math.sin(sh.phase * 0.65)
        : 1 + 0.06 * Math.sin(sh.phase * 0.5);
      const reachFin = this.shape.pectoral[3];
      this.finTipRight = L * reachFin * flex * (1 - bank);
      this.finTipLeft = L * reachFin * flex * (1 + bank);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < N; k++) {
        minX = Math.min(minX, spine[k * 2]);
        maxX = Math.max(maxX, spine[k * 2]);
        minY = Math.min(minY, spine[k * 2 + 1]);
        maxY = Math.max(maxY, spine[k * 2 + 1]);
      }
      const reach = sh.kind === "manta"
        ? Math.max(this.finTipRight, this.finTipLeft) + L * 0.06
        : L * 0.36;
      const c0 = Math.max(0, Math.floor((minX - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
      const r0 = Math.max(0, Math.floor((minY - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
      if (c0 > c1 || r0 > r1) continue;

      const skipBeyond = reach + Math.hypot(cw, ch);
      const shadowDc = Math.round((L * 0.035) / cw) + 1;
      const shadowDr = Math.round((L * 0.02) / ch) + 1;

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw;
          const y = r * ch;
          const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
          if (!centerHit && this.hitDist > skipBeyond) continue;
          const flag = this.hitFlag;
          const shade = this.hitShade;
          const s = this.hitS;
          const v = this.hitV;
          const angle = this.hitAngle;

          let hits = centerHit ? 1 : 0;
          let tailHit = centerHit && flag === FLAG_TAIL;
          let tailAngle = angle;
          for (let k = 0; k < SUBSAMPLES.length; k += 2) {
            if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) {
              hits++;
              if (this.hitFlag === FLAG_TAIL) {
                tailHit = true;
                tailAngle = this.hitAngle;
              }
            }
          }
          let dots = 0;
          if (this.mode === "braille") {
            for (let d = 0; d < BRAILLE_DOTS.length; d++) {
              const [ox, oy, bit] = BRAILLE_DOTS[d];
              if (!this.sampleShark(x + ox * cw, y + oy * ch, L)) continue;
              const density = this.hitFlag === FLAG_EYE ? 1
                : this.hitFlag === FLAG_MARK ? 0.3 : 0.36 + this.hitShade * 0.6;
              if (density >= DOT_THRESHOLDS[(d + (c + r) % 4) % 8]) dots |= bit;
            }
          }
          if (hits === 0 && dots === 0) continue;
          const coverage = hits / 5;

          const i = r * cols + c;
          // Body-anchored key so each glyph rides along with the skin.
          const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
          sharkKey[i] = key;
          sharkDepth[i] = sh.depth;
          sharkKind[i] = kindIndex;
          this.sharkDots[i] = dots;
          this.sharkAngle[i] = angle;

          if (tailHit && (!centerHit || flag === FLAG_TAIL)) {
            sharkFlag[i] = FLAG_TAIL;
            sharkShade[i] = 0.76;
            this.sharkAngle[i] = tailAngle;
          } else if (centerHit && coverage >= 0.6) {
            sharkFlag[i] = flag;
            const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
            sharkShade[i] = clamp(shade + flicker, 0, 1);
            const sc = c + shadowDc;
            const sr = r + shadowDr;
            if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
          } else {
            sharkFlag[i] = FLAG_EDGE;
            sharkShade[i] = coverage;
          }
        }
      }
      if (sh.kind === "manta" && this.mode !== "braille") {
        // Trace every crossed cell so a sub-cell whip cannot fall between AA samples.
        for (let k = 11; k < N - 1; k++) {
          const ax = spine[k * 2], ay = spine[k * 2 + 1];
          const dx = spine[k * 2 + 2] - ax, dy = spine[k * 2 + 3] - ay;
          const steps = Math.ceil(Math.hypot(dx, dy) / (cw * 0.25));
          for (let j = 0; j <= steps; j++) {
            const i = this.cellIndex(ax + dx * j / steps, ay + dy * j / steps);
            if (i < 0 || (sharkFlag[i] && sharkFlag[i] !== FLAG_EDGE && sharkFlag[i] !== FLAG_TAIL)) continue;
            sharkFlag[i] = FLAG_TAIL;
            sharkShade[i] = 0.76;
            sharkKind[i] = kindIndex;
            sharkDepth[i] = sh.depth;
            this.sharkAngle[i] = Math.atan2(dy, dx);
          }
        }
      }
    }
  }

  private drawSharks(t: number) {
    if (this.mode === "type") {
      this.drawTypeSharks();
      return;
    }
    if (this.mode !== "ascii") {
      this.drawSymbolSharks(t);
      return;
    }
    const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind } = this;
    const accents = this.dark ? NIGHT_ACCENTS : ACCENTS;
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const flag = sharkFlag[i];
      if (!flag) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      const x = col * cw;
      const y = row * ch;
      const key = sharkKey[i];
      const shade = sharkShade[i];
      const dim = 0.7 + 0.3 * sharkDepth[i];
      if (flag === FLAG_TAIL) {
        this.drawWhipCell(i, x, y, dim);
        continue;
      }
      const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;

      // Colours re-roll on a staggered clock so the hide shimmers.
      const tick = Math.floor(t * 2.4 + (key % 997) / 97);
      const roll = hash3(key, tick, 7);

      if (flag === FLAG_EDGE) {
        // Soft, anti-aliased silhouette: no block, just a light glyph.
        const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
        const g = (this.dark ? 92 + shade * 73 : 70 + shade * 80) * dim;
        ctx.fillStyle =
          roll < 0.07
            ? accents[key % accents.length]
            : `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.min(255, Math.round(g * tb + 6))})`;
        ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
        continue;
      }

      let level: number;
      let glyph: string;
      if (flag === FLAG_RIDGE) {
        level = 226;
        glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
      } else if (flag === FLAG_EYE) {
        level = 12;
        glyph = "o";
      } else if (flag === FLAG_MARK) {
        level = 24 + shade * 22;
        glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
      } else if (flag === FLAG_FIN) {
        level = 40 + shade * 120;
        glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
      } else {
        level = 46 + shade * 160;
        const jitter = ((key >>> 4) % 3) - 1;
        glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
      }
      level *= dim * (this.dark ? 0.8 : 1);
      // Tinted per species; the classic tint is a cool blue-grey, like a back seen through deep water.
      ctx.fillStyle = this.dark
        ? `rgb(${Math.round(level * tr * 0.78)},${Math.min(255, Math.round(level * tg * 0.99 + 8))},${Math.min(255, Math.round(level * tb * 1.08 + 15))})`
        : `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`;
      ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

      let color: string;
      if (flag === FLAG_EYE) color = this.dark ? "#a9d1d5" : "#9aa0ad";
      else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;
      else if (roll < 0.09) color = accents[key % accents.length];
      else if (roll < 0.13) color = this.dark ? "#bfd5df" : "#ffffff";
      else if (this.dark && KINDS[sharkKind[i]] === "manta") color = shade > 0.7 ? "#20313a" : "#43606e";
      else color = this.dark ? (shade > 0.55 ? "#0e202b" : "#a2bac6") : (shade > 0.55 ? "#0e0f13" : "#1b1d24");
      ctx.fillStyle = color;
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
    }
  }

  /** Monochrome type art: the glyphs alone carry silhouette, shading and skin markings. */
  private drawTypeSharks() {
    const { ctx, cw, ch, cols, sharkFlag, sharkShade, sharkDepth, sharkKey } = this;
    ctx.save();
    ctx.font = `600 ${Math.round(ch * 0.86)}px ${this.fontFamily}`;
    ctx.fillStyle = this.dark ? "#dce9ee" : "#d8dee4";
    for (let i = 0; i < sharkFlag.length; i++) {
      const flag = sharkFlag[i];
      if (!flag) continue;
      const shade = sharkShade[i];
      const key = sharkKey[i];
      const edge = flag === FLAG_EDGE;
      const depth = 0.78 + 0.22 * sharkDepth[i];
      let tone = 0.25 + shade * 0.65;
      if (flag === FLAG_RIDGE) tone = 0.96;
      else if (flag === FLAG_MARK || flag === FLAG_EYE) tone = 0.16;
      else if (flag === FLAG_FIN) tone = 0.2 + shade * 0.55;
      else if (edge) tone = 0.08 + shade * 0.22;
      // Body-anchored variation keeps letters attached to the fish as it swims.
      const jitter = ((key >>> 5) % 3) - 1;
      const family = TYPE_GLYPHS[clamp(Math.round(tone * 7) + jitter, 0, 7)];
      let glyph = family[(key >>> 10) % family.length];
      if (flag === FLAG_EYE) glyph = ":";
      if (flag === FLAG_TAIL) {
        const direction = ((Math.round(this.sharkAngle[i] / (Math.PI / 4)) % 4) + 4) % 4;
        glyph = ["-", "\\", "|", "/"][direction];
      }
      ctx.globalAlpha = depth * (edge ? 0.35 + shade * 0.4 : 0.72 + tone * 0.26);
      ctx.fillText(glyph, (i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch / 2 + 1, cw * 0.9);
    }
    ctx.restore();
  }

  /** Draw the same body grid using distinct symbol vocabularies, without resetting the world. */
  private drawSymbolSharks(t: number) {
    const { ctx, cw, ch, cols, sharkFlag, sharkShade, sharkDepth, sharkKey, sharkKind } = this;
    const accents = this.dark ? NIGHT_ACCENTS : ACCENTS;
    ctx.save();
    ctx.font = this.mode === "hanzi"
      ? `500 ${Math.round(cw * 0.98)}px OceanHanzi, sans-serif`
      : `600 ${Math.round(ch * 0.9)}px ${this.fontFamily}`;
    for (let i = 0; i < sharkFlag.length; i++) {
      const flag = sharkFlag[i];
      if (!flag) continue;
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      const shade = sharkShade[i];
      const key = sharkKey[i];
      const edge = flag === FLAG_EDGE;
      const dim = 0.7 + sharkDepth[i] * 0.3;
      if (flag === FLAG_TAIL && this.mode !== "braille") {
        this.drawWhipCell(i, x, y, dim);
        continue;
      }
      const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;
      const level = (flag === FLAG_MARK ? 90 : (120 + shade * 115) * dim) * (this.dark ? 0.82 : 1);
      const accent = hash3(key, Math.floor(t * 1.7), 17) < 0.035;
      ctx.fillStyle = accent ? accents[key % accents.length]
        : this.dark
          ? `rgb(${Math.round(level * tr * 0.84)},${Math.min(255, Math.round(level * tg + 8))},${Math.min(255, Math.round(level * tb * 1.06 + 12))})`
          : `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb))})`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.globalAlpha = edge ? 0.45 + shade * 0.4 : 1;

      if (this.mode === "braille") {
        // Draw the eight Unicode point positions directly so font fallback cannot produce tofu.
        const mask = this.sharkDots[i];
        const radius = Math.max(0.65, cw * 0.105);
        ctx.beginPath();
        for (const [ox, oy, bit] of BRAILLE_DOTS) {
          if (!(mask & bit)) continue;
          ctx.moveTo(x + ox * cw + radius, y + oy * ch);
          ctx.arc(x + ox * cw, y + oy * ch, radius, 0, Math.PI * 2);
        }
        ctx.fill();
        continue;
      }

      if (flag === FLAG_EYE) {
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch / 2, Math.max(1.2, cw * 0.18), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      if (this.mode === "geometry") {
        const cx = x + cw / 2, cy = y + ch / 2;
        const radius = cw * (edge ? 0.13 : 0.27 + shade * 0.15);
        const shape = (key >>> 4) % 4;
        ctx.lineWidth = Math.max(0.7, cw * 0.075);
        ctx.beginPath();
        if (edge || shape < 2) {
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        } else if (shape === 2) {
          ctx.moveTo(cx, cy - radius * 1.25); ctx.lineTo(cx + radius, cy);
          ctx.lineTo(cx, cy + radius * 1.25); ctx.lineTo(cx - radius, cy); ctx.closePath();
        } else {
          ctx.rect(cx - radius * 0.85, cy - radius * 0.85, radius * 1.7, radius * 1.7);
        }
        if (edge || shade > 0.6 || flag === FLAG_RIDGE) ctx.fill(); else ctx.stroke();
        continue;
      }

      let glyph = "";
      if (this.mode === "blocks") {
        const ramp = "░▒▓█";
        glyph = edge ? "░" : ramp[clamp(Math.floor(shade * 3.99), 0, 3)];
        if (!edge && flag === FLAG_FIN) glyph = (key & 1) ? "▄" : "▀";
      } else if (this.mode === "lines") {
        const direction = ((Math.round(this.sharkAngle[i] / (Math.PI / 4)) % 4) + 4) % 4;
        glyph = ["─", "╲", "│", "╱"][direction];
        if (!edge && (flag === FLAG_RIDGE || shade > 0.85)) glyph = "┼";
        ctx.globalAlpha *= edge ? 0.8 : 0.65 + shade * 0.35;
      } else {
        const ramp = "一十川山水海浪魚鯊";
        glyph = edge ? ((key & 1) ? "一" : "十")
          : ramp[clamp(Math.floor(shade * (ramp.length - 1)) + ((key >>> 3) % 3) - 1, 0, ramp.length - 1)];
        // A small aligned field of actual CJK characters, with no per-cell solid background.
        ctx.globalAlpha *= edge ? 0.55 : 1;
      }
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1, cw * 0.98);
    }
    ctx.restore();
  }

  /** Fine aligned strokes keep the manta whip legible without solid tail blocks. */
  private drawWhipCell(i: number, x: number, y: number, dim: number) {
    const { ctx, cw, ch } = this;
    const direction = ((Math.round(this.sharkAngle[i] / (Math.PI / 4)) % 4) + 4) % 4;
    ctx.save();
    ctx.globalAlpha = 0.75 * dim;
    ctx.fillStyle = this.dark ? "#b0d2df" : "#a9bbc3";
    ctx.font = `400 ${Math.round(ch)}px ${this.fontFamily}`;
    ctx.fillText(["─", "╲", "│", "╱"][direction], x + cw / 2, y + ch / 2 + 1, cw * 1.1);
    ctx.restore();
  }

  // ── fish, dots, heat ────────────────────────────────────────────────

  /**
   * Snap each fish to a cell and bucket it by brightness: far fish are dim,
   * near fish brighter, and turning or panicking fish glint. Nearer fish
   * claim a cell first when two land in the same one.
   */
  private markFish(world: World) {
    const { fishStamp, fishBuckets, sharkFlag } = this;
    const frame = ++this.frameId;
    for (const bucket of fishBuckets) bucket.length = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const f of world.fish) {
        if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
        fishStamp[i] = frame;
        const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
        const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
        fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);
      }
    }
  }

  private drawFish() {
    const { ctx, cw, ch, cols, fishBuckets } = this;
    for (let b = 0; b < fishBuckets.length; b++) {
      const bucket = fishBuckets[b];
      if (!bucket.length) continue;
      ctx.fillStyle = this.fishStyles[b];
      for (const i of bucket) {
        ctx.fillText("-", (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }
  }

  private drawHeat() {
    const { ctx, heat, cols, cw, ch } = this;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i];
      if (h < 0.08) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      ctx.fillStyle = this.mode === "type" ? `rgba(210,231,239,${Math.min(1, h).toFixed(2)})`
        : h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
      ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
    }
  }

  /**
   * Every cell's dot twinkles on its own clock, is modulated by slow
   * caustic light bands, and flares cyan where the wake field is strong.
   * Dots are bucketed by colour/alpha so each bucket is one fillStyle.
   */
  private drawDots(t: number) {
    const { ctx, cols, rows, cw, ch, dotKind, dotPhase, dotFreq, energy, sharkFlag, sharkShadow, fishStamp, frameId } = this;
    ctx.save();
    if (this.dark) ctx.globalAlpha = 0.55;
    const { bucketOf, bucketOrder, bucketCounts } = this;
    const n = cols * rows;
    const SKIP = bucketCounts.length - 1;
    bucketCounts.fill(0);

    for (let i = 0; i < n; i++) {
      const e = energy[i];
      const kind = dotKind[i];
      if (sharkFlag[i] || fishStamp[i] === frameId || (kind === 0 && e < 0.45)) {
        bucketOf[i] = SKIP;
        continue;
      }
      let bucket: number;
      if (e > 0.45) {
        const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
        bucket = WAKE * ALPHA_LEVELS + level;
      } else {
        const col = i % cols;
        const row = (i / cols) | 0;
        // Dots stay bright and crisp; the twinkle is a gentle breathe, not a fade.
        const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
        const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
        let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);
        if (sharkShadow[i]) v *= 0.2;
        bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
      }
      bucketOf[i] = bucket;
      bucketCounts[bucket]++;
    }

    // Counting sort cells by bucket.
    const starts = new Int32Array(bucketCounts.length);
    for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];
    const cursor = starts.slice();
    for (let i = 0; i < n; i++) {
      const b = bucketOf[i];
      if (b !== SKIP) bucketOrder[cursor[b]++] = i;
    }

    const small = Math.max(2, Math.round(cw * 0.19));
    const large = small + 1;
    for (let b = 0; b < SKIP; b++) {
      const count = bucketCounts[b];
      if (!count) continue;
      ctx.fillStyle = this.dotStyles[b];
      const size = b >= WAKE * ALPHA_LEVELS ? large : small;
      const start = starts[b];
      for (let k = start; k < start + count; k++) {
        const i = bucketOrder[k];
        const col = i % cols;
        const row = (i / cols) | 0;
        // Sit the dot low-right in its cell, as in the reference.
        if (this.mode === "type") {
          ctx.fillStyle = "rgba(164,195,209,0.3)";
          ctx.fillText(".", col * cw + cw / 2, row * ch + ch / 2 + 1);
        } else {
          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
        }
      }
    }
    ctx.restore();
  }
}
