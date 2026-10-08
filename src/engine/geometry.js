// Shared mechanical geometry. Units are visual design units (≈4.8 cm each);
// y is up, z points towards the typist, x to the typist's right. The desk
// surface is y = 0 and the machine origin sits on it.
//
// The carriage group only translates along x. Platen, paper and bail live in
// carriage-local coordinates whose y/z equal machine coordinates.

const deg = Math.PI / 180;

export const PLATEN = {y: 3.12, z: -1.42, r: 0.43, length: 7.1};
export const PAPER_GAP = 0.012;            // paper sits just outside the rubber
export const PAPER_R = PLATEN.r + PAPER_GAP;

// Angles are measured on the platen from +z (facing the typist) towards +y.
export const STRIKE_ANGLE = 7 * deg;       // printing line, just above centre
export const BAIL_ANGLE = 38 * deg;        // bail rollers press the sheet here, between lines 1 and 2 above
export const BACK_ANGLE = -142 * deg;      // sheet leaves the platen to the table

export const STRIKE = {
  x: 0,
  y: PLATEN.y + PAPER_R * Math.sin(STRIKE_ANGLE),
  z: PLATEN.z + PAPER_R * Math.cos(STRIKE_ANGLE),
};

export const S_EXIT = PAPER_R * (BAIL_ANGLE - STRIKE_ANGLE);   // > 0
export const S_BACK = PAPER_R * (BACK_ANGLE - STRIKE_ANGLE);   // < 0

// Lean angles of the free segments, measured as the continuation of the
// platen angle (direction = (cos θ, -sin θ) in (y, z)).
const FRONT_SUPPORT_ANGLE = 36 * deg;
const FRONT_SUPPORT_LENGTH = 2.8;
const BACK_SUPPORT_LENGTH = 2.9;
const MAX_FRONT = 104 * deg;

/**
 * Precomputed centre-line of the paper path as a function of arclength s
 * (s = 0 on the printing line; s > 0 runs up out of the machine towards the
 * reader; s < 0 runs around the platen underside and up the paper table).
 * The table is rebuilt only when stiffness changes.
 */
export class PaperPath {
  constructor(stiffness = 0.6) {
    this.step = 0.02;
    this.setStiffness(stiffness);
  }
  setStiffness(stiffness) {
    this.stiffness = stiffness;
    const sag = 0.05 + (1 - stiffness) * 0.42;
    const step = this.step;
    // Front free segment.
    const frontLen = 9;
    const n = Math.ceil(frontLen / step) + 1;
    this.front = new Float32Array(n * 4); // y, z, ny, nz
    let y = PLATEN.y + PAPER_R * Math.sin(BAIL_ANGLE);
    let z = PLATEN.z + PAPER_R * Math.cos(BAIL_ANGLE);
    for (let i = 0; i < n; i++) {
      const u = i * step;
      let theta;
      if (u < FRONT_SUPPORT_LENGTH) {
        const k = u / FRONT_SUPPORT_LENGTH;
        theta = BAIL_ANGLE + (FRONT_SUPPORT_ANGLE - BAIL_ANGLE) * k * k * (3 - 2 * k);
      } else {
        const over = u - FRONT_SUPPORT_LENGTH;
        theta = Math.min(MAX_FRONT, FRONT_SUPPORT_ANGLE + sag * over * over);
      }
      const dy = Math.cos(theta), dz = -Math.sin(theta);
      this.front[i * 4] = y; this.front[i * 4 + 1] = z;
      // Outward normal (printed side) is the direction rotated by +90°.
      this.front[i * 4 + 2] = -dz; this.front[i * 4 + 3] = dy;
      y += dy * step; z += dz * step;
    }
    // Back segment: lies on the paper table, then droops over its top edge.
    const backLen = 9;
    const m = Math.ceil(backLen / step) + 1;
    this.back = new Float32Array(m * 4);
    y = PLATEN.y + PAPER_R * Math.sin(BACK_ANGLE);
    z = PLATEN.z + PAPER_R * Math.cos(BACK_ANGLE);
    const lean = Math.PI + BACK_ANGLE;      // table lean from vertical, ~38°
    for (let i = 0; i < m; i++) {
      const u = i * step;
      const over = Math.max(0, u - BACK_SUPPORT_LENGTH);
      const theta = Math.min(100 * deg, lean + sag * 0.7 * over * over);
      // Going up the table: direction (cos θ, -sin θ).
      const dy = Math.cos(theta), dz = -Math.sin(theta);
      this.back[i * 4] = y; this.back[i * 4 + 1] = z;
      // The printed side lies against the table (down/back).
      this.back[i * 4 + 2] = dz; this.back[i * 4 + 3] = -dy;
      y += dy * step; z += dz * step;
    }
  }
  /** Writes [y, z, ny, nz] for arclength s into out. */
  sample(s, out) {
    if (s >= S_EXIT) {
      const f = (s - S_EXIT) / this.step;
      return lerpTable(this.front, f, out);
    }
    if (s <= S_BACK) {
      const f = (S_BACK - s) / this.step;
      return lerpTable(this.back, f, out);
    }
    const a = STRIKE_ANGLE + s / PAPER_R;
    out[0] = PLATEN.y + PAPER_R * Math.sin(a);
    out[1] = PLATEN.z + PAPER_R * Math.cos(a);
    out[2] = Math.sin(a);
    out[3] = Math.cos(a);
    return out;
  }
}

function lerpTable(table, f, out) {
  const last = table.length / 4 - 1;
  if (f >= last) f = last - 1e-4;
  const i = Math.floor(f), t = f - i;
  const a = i * 4, b = a + 4;
  for (let k = 0; k < 4; k++) out[k] = table[a + k] + (table[b + k] - table[a + k]) * t;
  return out;
}

// --------------------------------------------------------------------------
// Typebasket geometry (fixed to the machine body).
export const BASKET = {
  pivotRadius: 1.02,       // segment radius around the printing point (plan view)
  pivotY: STRIKE.y - 1.08, // pivots sit below the printing line
  restDrop: 0.16,          // bars rest sloping slightly downward and outward
  span: 78 * deg,          // half-angle of the fan
};
BASKET.barLength = Math.hypot(BASKET.pivotRadius, STRIKE.y - BASKET.pivotY) - 0.03;
