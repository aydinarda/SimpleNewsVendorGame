function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomUniform(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function randomTriangular(min, mode, max) {
  const u = Math.random();
  const c = (mode - min) / (max - min);

  if (u <= c) {
    return Math.round(min + Math.sqrt(u * (max - min) * (mode - min)));
  }

  return Math.round(max - Math.sqrt((1 - u) * (max - min) * (max - mode)));
}

function randomNormal(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

export function sampleDemand(distribution) {
  switch (distribution.type) {
    case "uniform":
      return randomUniform(distribution.min, distribution.max);
    case "triangular":
      return randomTriangular(distribution.min, distribution.mode, distribution.max);
    case "normal": {
      const draw = randomNormal(distribution.mean, distribution.stdDev);
      return Math.round(clamp(draw, distribution.min, distribution.max));
    }
    default:
      throw new Error(`Unsupported distribution type: ${distribution.type}`);
  }
}
