// Keep render work bounded on high-DPI and high-refresh-rate displays.
export const QUALITY = {
  high: {pixelRatio: 2, maxPixels: 4000000, shadow: 'high', shadowFps: 30},
  medium: {pixelRatio: 1.25, maxPixels: 1600000, shadow: 'medium', shadowFps: 15},
  low: {pixelRatio: 1, maxPixels: 900000, shadow: 'low', shadowFps: 10},
};

export function renderPixelRatio(level, width, height, deviceRatio = 1) {
  const q = QUALITY[level] || QUALITY.medium;
  const pixels = Math.max(1, width * height);
  return Math.min(deviceRatio || 1, q.pixelRatio, Math.sqrt(q.maxPixels / pixels));
}

export class FramePacer {
  reset() { this.last = undefined; this.fps = undefined; }
  shouldRender(now, fps) {
    const interval = 1000 / fps;
    if (this.last === undefined || this.fps !== fps) {
      this.last = now;
      this.fps = fps;
      return true;
    }
    const elapsed = now - this.last;
    // Chrome's RAF timestamps can arrive about 2 ms early. Keep that frame
    // rather than introduce a visible 33 ms gap on an otherwise healthy 60 Hz display.
    const tolerance = 2;
    if (elapsed < interval - tolerance) return false;
    // Retain fractional time instead of turning 144 Hz into a 48 fps cap.
    this.last += Math.max(1, Math.floor((elapsed + tolerance) / interval)) * interval;
    return true;
  }
}

export class AutoQuality {
  reset() { this.start = undefined; this.frames = 0; }
  sample(now, active) {
    // Idle throttling and background tabs are deliberate, not poor GPU performance.
    if (!active) { this.reset(); return false; }
    if (this.start === undefined) { this.start = now; this.frames = 0; return false; }
    this.frames++;
    if (now - this.start < 3000) return false;
    const slow = (now - this.start) / this.frames > 27;
    this.reset();
    return slow;
  }
}
