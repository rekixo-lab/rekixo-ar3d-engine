import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Opt-in browser conversion for accounts without Cloudflare Containers.
// Does not modify the sealed source pack; the derived GLB is verified independently.
export type BrowserFbxAnalysis = {
  root: THREE.Group;
  rawDimensions: [number, number, number];
  declaredMetresPerUnit: number;
  originalUnitScaleFactor: number;
  meshCount: number;
  inputSha256: string;
};

const bounds = (root: THREE.Object3D): [number, number, number] => {
  const dimension = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return [dimension.x, dimension.y, dimension.z];
};

function consolidateMaterialGroups(geometry: THREE.BufferGeometry) {
  if (geometry.groups.length < 2) return;
  const groups = new Map<number, number[]>();
  for (const group of geometry.groups) {
    const target = groups.get(group.materialIndex) ?? [];
    for (let index = group.start; index < group.start + group.count; index++)
      target.push(geometry.index ? geometry.index.getX(index) : index);
    groups.set(group.materialIndex, target);
  }
  const indices: number[] = [];
  geometry.clearGroups();
  for (const [materialIndex, groupIndices] of groups) {
    geometry.addGroup(indices.length, groupIndices.length, materialIndex);
    indices.push(...groupIndices);
  }
  geometry.setIndex(indices);
}

export async function analyseBrowserFbx(file: File): Promise<BrowserFbxAnalysis> {
  if (!/\.fbx$/i.test(file.name)) throw Error("Select a .fbx source original.");
  if (!file.size || file.size > 64 * 1024 * 1024)
    throw Error("Browser FBX conversion accepts originals up to 64 MiB.");
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const inputSha256 = [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const manager = new THREE.LoadingManager();
  // External bitmap references are not included in the source pack. Keep the
  // authored material names; do not download images from untrusted FBX paths.
  manager.addHandler(/.*/, {
    setPath() { return this; },
    load() { return new THREE.Texture(); },
  } as unknown as THREE.Loader);
  const root = new FBXLoader(manager).parse(buffer, "");
  root.updateMatrixWorld(true);
  const rawDimensions = bounds(root);
  let meshCount = 0;
  root.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshCount++; });
  const originalUnitScaleFactor = Number(root.userData.unitScaleFactor);
  if (!meshCount || rawDimensions.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(originalUnitScaleFactor) || originalUnitScaleFactor <= 0)
    throw Error("FBX geometry or declared unit scale is missing; use a reviewed 3D source.");
  return { root, rawDimensions, originalUnitScaleFactor,
    declaredMetresPerUnit: originalUnitScaleFactor / 100, meshCount, inputSha256 };
}

export function reviewedDimensions(
  analysis: BrowserFbxAnalysis,
  metresPerSourceUnit: number,
): [number, number, number] {
  if (!Number.isFinite(metresPerSourceUnit) || metresPerSourceUnit < 0.000001 ||
      metresPerSourceUnit > 1000000)
    throw Error("A valid reviewed metres-per-source-unit scale is required.");
  const dimensions = analysis.rawDimensions.map((value) => value * metresPerSourceUnit)
    as [number, number, number];
  const maximum = Math.max(...dimensions);
  if (maximum < 2 || maximum > 2000)
    throw Error("Canonical site bounds fall outside the 2–2000 m sanity range. Review the scale.");
  return dimensions;
}

export async function exportReviewedBrowserGlb(
  file: File,
  analysis: BrowserFbxAnalysis,
  metresPerSourceUnit: number,
): Promise<File> {
  const dimensions = reviewedDimensions(analysis, metresPerSourceUnit);
  const root = analysis.root;
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    consolidateMaterialGroups(mesh.geometry);
    const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = original.map((material) => {
      const source = material as THREE.MeshStandardMaterial;
      let standard = materialCache.get(source.uuid);
      if (!standard) {
        standard = new THREE.MeshStandardMaterial({
          name: source.name, color: source.color ?? new THREE.Color(0xffffff),
          opacity: source.opacity, transparent: source.transparent,
          side: source.side, metalness: 0, roughness: 0.72,
        });
        materialCache.set(source.uuid, standard);
      }
      return standard;
    });
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
  });
  root.scale.multiplyScalar(metresPerSourceUnit);
  root.userData.sourceUnitScaleFactorCmPerUnit = analysis.originalUnitScaleFactor;
  root.userData.unitScaleFactor = 100;
  root.userData.sourceGeometry = {
    derivedFrom: file.name,
    sourceSha256: analysis.inputSha256,
    coordinatePolicy: "operator-reviewed-browser-fbx-to-metres",
    appliedMetresPerSourceUnit: metresPerSourceUnit,
    canonicalDimensionsM: dimensions,
    operatorReviewRequired: true,
    texturePolicy: "external-source-bitmaps-not-embedded",
  };
  root.updateMatrixWorld(true);
  const bytes = await new GLTFExporter().parseAsync(root, { binary: true });
  if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 256 * 1024 * 1024)
    throw Error("FBX conversion did not produce a valid-size binary GLB.");
  // Browser converted GLB stays a separate source; the FBX original is never overwritten.
  return new File([bytes], file.name.replace(/\.fbx$/i, "") + "-reviewed.glb", {
    type: "model/gltf-binary",
  });
}
