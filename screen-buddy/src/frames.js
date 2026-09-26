// Cheap "did the screen actually change?" check so auto check-ins don't pay
// for an API call when you've been staring at the same thing.

// bitmap: BGRA buffer from nativeImage.toBitmap() of a tiny thumbnail.
function toGray(bitmap) {
  const out = new Uint8Array(bitmap.length / 4);
  for (let i = 0, j = 0; i < bitmap.length; i += 4, j++) {
    out[j] = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
  }
  return out;
}

// Mean absolute difference between two grayscale frames, 0..255.
function frameDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// Screenshot widths offered in the panel. Each image costs roughly
// width*height/750 tokens of context (16:9: 1024 ≈ 800, 1280 ≈ 1.2k,
// 1568 ≈ 1.8k, 1920 ≈ 2.8k).
const SHOT_WIDTHS = [1024, 1280, 1568, 1920];
const DEFAULT_SHOT_WIDTH = 1280;

function normalizeShotWidth(w) {
  return SHOT_WIDTHS.includes(Number(w)) ? Number(w) : DEFAULT_SHOT_WIDTH;
}

// Size to capture a physW x physH screen at, so its width is at most `width`
// (never upscaled), keeping the aspect ratio.
function captureSize(physW, physH, width) {
  const w = Math.min(physW, normalizeShotWidth(width));
  return { width: w, height: Math.round((physH * w) / physW) };
}

module.exports = { toGray, frameDiff, captureSize, normalizeShotWidth, SHOT_WIDTHS, DEFAULT_SHOT_WIDTH };
