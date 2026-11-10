import type { IUniform, MeshStandardMaterial } from 'three';

export interface FacadeUniforms {
  /** 0 by day, 1 at night: fades in lit windows. */
  uNight: IUniform<number>;
}

/**
 * Procedural facades for the merged building mesh: a window grid and storey lines drawn in the
 * fragment shader from the `facade` attribute (metres along the wall, metres above the base, seed).
 * No textures and no extra draw calls. The pattern is generic, not imagery of the real buildings:
 * one storey per 3.2 m (the same assumption as the height heuristic) and a 3 m window bay.
 * It fades out with distance (screen-space derivatives) so it never aliases into moire.
 */
export function applyFacadeShader(material: MeshStandardMaterial): FacadeUniforms {
  const uniforms: FacadeUniforms = { uNight: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uNight'] = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 facade;\nvarying vec3 vFacade;\nvarying float vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;\nvWall = 1.0 - step(0.5, normal.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uNight;
        varying vec3 vFacade;
        varying float vWall;
        float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float windowLight = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        if (vWall > 0.5) {
          vec2 cell = vec2(vFacade.x / 3.0, vFacade.y / 3.2);
          vec2 f = fract(cell);
          vec2 id = floor(cell);
          float footprint = max(fwidth(cell.x), fwidth(cell.y));
          float detail = 1.0 - smoothstep(0.25, 0.7, footprint);
          float win = smoothstep(0.20, 0.25, f.x) * (1.0 - smoothstep(0.75, 0.80, f.x))
                    * smoothstep(0.30, 0.35, f.y) * (1.0 - smoothstep(0.78, 0.83, f.y)) * detail;
          float storeyLine = (1.0 - smoothstep(0.0, 0.07, f.y)) * detail;
          float r = facadeHash(id + vFacade.z * 97.0);
          diffuseColor.rgb *= 1.0 - 0.16 * storeyLine;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.09, 0.11) + 0.05 * r, win * 0.8);
          // About a third of the windows are lit at night, in warm and cool tones.
          windowLight = win * step(0.66, r) * uNight;
          // Beyond the distance where single windows resolve, keep their average glow so the far city is not dark.
          windowLight += (1.0 - detail) * 0.05 * uNight;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(vec3(1.0, 0.72, 0.38), vec3(0.75, 0.85, 1.0), step(0.9, facadeHash(vFacade.zz + floor(vFacade.xy)))) * windowLight * 1.6;`,
      );
  };
  return uniforms;
}
