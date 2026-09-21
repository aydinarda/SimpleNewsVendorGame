function randomUniform(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function randomNormal(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); //1/sqrt(2 * Math.PI) * exp(-0.5 * z * z)
  return mean + z * stdDev;
}

// Inverse-CDF draw: the density rises linearly from min to a peak at mode, then falls to max.
function randomTriangular(min, mode, max) {
  if (max === min) return min;
  const u = Math.random();
  const peakAt = (mode - min) / (max - min);
  return u < peakAt
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

export function sampleDemand(distribution) {
  switch (distribution.type) {
    case "uniform":
      return randomUniform(distribution.min, distribution.max);
    case "normal":
      // Negative draws map straight to 0 (no resampling).
      return Math.max(0, Math.round(randomNormal(distribution.mean, distribution.stdDev)));
    case "triangular":
      return Math.round(randomTriangular(distribution.min, distribution.mode, distribution.max));
    default:
      throw new Error(`Unsupported distribution type: ${distribution.type}`);
  }
}
