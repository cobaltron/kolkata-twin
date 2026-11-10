/** Device-dependent render settings. Chosen once at start-up. */
export interface QualityTier {
  name: 'desktop' | 'mobile';
  maxPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  /** Reference half-width in metres of the shadowed square; the sky layer scales it with camera distance. */
  shadowRadius: number;
  /** Rain streak budget at the heaviest rain rate. */
  maxRainDrops: number;
  /** Simulated road vehicles at the busiest hour. */
  maxVehicles: number;
}

export function detectQuality(): QualityTier {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const forced = new URLSearchParams(location.search).get('quality');
  const mobile = forced ? forced === 'mobile' : coarse;
  return mobile
    ? { name: 'mobile', maxPixelRatio: 1.5, antialias: false, shadowMapSize: 1024, shadowRadius: 500, maxRainDrops: 5000, maxVehicles: 700 }
    : { name: 'desktop', maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, shadowRadius: 900, maxRainDrops: 14000, maxVehicles: 2500 };
}
