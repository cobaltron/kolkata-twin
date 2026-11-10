import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData } from './geometry/MeshBuffers';
import type { CityGeometry, WorkerRequest, WorkerResponse } from './protocol';

/** Loads the preprocessed city once, in a web worker, and shares it between layers. */
export class CityData {
  private promise: Promise<CityGeometry> | null = null;

  constructor(private readonly url: string) {}

  load(): Promise<CityGeometry> {
    this.promise ??= new Promise<CityGeometry>((resolve, reject) => {
      const worker = new Worker(new URL('./city.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        worker.terminate();
        if (ev.data.ok) resolve(ev.data.city);
        else reject(new Error(ev.data.error));
      };
      worker.onerror = (ev) => {
        worker.terminate();
        reject(new Error(ev.message || 'city worker failed'));
      };
      worker.postMessage({ url: new URL(this.url, document.baseURI).href } satisfies WorkerRequest);
    });
    return this.promise;
  }
}

export function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  if (mesh.colors) g.setAttribute('color', new BufferAttribute(mesh.colors, 3, true));
  if (mesh.normals) g.setAttribute('normal', new BufferAttribute(mesh.normals, 3, true));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  return g;
}
