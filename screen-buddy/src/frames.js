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

module.exports = { toGray, frameDiff };
