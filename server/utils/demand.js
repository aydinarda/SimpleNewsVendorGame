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

export function sampleDemand(distribution) {
  switch (distribution.type) {
    case "uniform":
      return randomUniform(distribution.min, distribution.max);
    case "normal":
      // Negative draws map straight to 0 (no resampling).
      return Math.max(0, Math.round(randomNormal(distribution.mean, distribution.stdDev)));
    default:
      throw new Error(`Unsupported distribution type: ${distribution.type}`);
  }
}
