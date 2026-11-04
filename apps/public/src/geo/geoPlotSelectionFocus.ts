import * as THREE from "three";
import { geoPlotFocusMotion } from "../../../../shared/geo-plot-focus-motion.js";

/**
 * GLB-local, depth-tested selection overlay, separate from commercial status.
 * It never changes mapped vertices, plot status, or hit geometry.
 * Only one selected plot allocates focus objects at a time.
 */
export type GeoPlotFocusSource = {
  id: string;
  corners: Array<[number, number]>;
  surfaceY: number;
};

export function createGeoPlotSelectionFocus() {
  const group = new THREE.Group();
  group.name = "geo-selected-plot-focus";
  let selectedId: string | null = null;
  let startedAt = 0;
  let fill: THREE.Mesh | null = null;
  let halo: THREE.Mesh | null = null;
  let ripple: THREE.Mesh | null = null;
  let edge: THREE.LineLoop | null = null;
  let dots: THREE.Points | null = null;

  const clear = () => {
    for (const child of [fill, halo, ripple, edge, dots]) {
      if (!child) continue;
      child.removeFromParent();
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    selectedId = null;
    fill = null;
    halo = null;
    ripple = null;
    edge = null;
    dots = null;
  };

  const setAccent = (hex: number) => {
    if (fill) (fill.material as THREE.MeshBasicMaterial).color.setHex(hex);
    if (halo) (halo.material as THREE.MeshBasicMaterial).color.setHex(hex);
    if (ripple) (ripple.material as THREE.MeshBasicMaterial).color.setHex(hex);
  };

  const select = (plot: GeoPlotFocusSource | null, accent: number, now: number) => {
    if (!plot || plot.corners.length < 3) {
      clear();
      return;
    }
    if (selectedId === plot.id) {
      setAccent(accent);
      startedAt = now; // Repeated tap restarts the pulse without reallocating.
      return;
    }
    clear();
    selectedId = plot.id;
    startedAt = now;
    const points = plot.corners;
    const height = plot.surfaceY + 0.055;
    const shape = new THREE.Shape();
    points.forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    const shapeGeometry = new THREE.ShapeGeometry(shape);
    shapeGeometry.rotateX(Math.PI / 2);
    shapeGeometry.translate(0, height, 0);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.47,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    fill = new THREE.Mesh(shapeGeometry, fillMaterial);
    fill.renderOrder = 24;
    fill.name = "selected-plot-soft-tint";

    // Status-colored ribbon follows the exact mapped footprint, not the terrain.
    const xs = points.map(p => p[0]);
    const zs = points.map(p => p[1]);
    const minSpan = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const width = Math.max(0.035, Math.min(0.24, minSpan * 0.018));
    const area = points.reduce((sum, a, index) => {
      const b = points[(index + 1) % points.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    const direction = area >= 0 ? 1 : -1;
    const bandVertices: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const [ax, az] = points[index];
      const [bx, bz] = points[(index + 1) % points.length];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 1e-7) continue;
      const nx = direction * dz / length * width;
      const nz = direction * -dx / length * width;
      const a0: [number, number, number] = [ax - nx, height + 0.007, az - nz];
      const a1: [number, number, number] = [ax + nx, height + 0.007, az + nz];
      const b0: [number, number, number] = [bx - nx, height + 0.007, bz - nz];
      const b1: [number, number, number] = [bx + nx, height + 0.007, bz + nz];
      bandVertices.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
    }
    const bandGeometry = new THREE.BufferGeometry();
    bandGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bandVertices, 3));
    halo = new THREE.Mesh(bandGeometry, new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
    }));
    halo.renderOrder = 25;
    halo.name = "selected-plot-status-glow";

    // A status-colored ribbon expands around the actual plot center, not the map origin.
    const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const centerZ = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const rippleGeometry = bandGeometry.clone();
    rippleGeometry.translate(-centerX, 0, -centerZ);
    ripple = new THREE.Mesh(rippleGeometry, new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false,
    }));
    ripple.position.set(centerX, 0, centerZ);
    ripple.renderOrder = 25.5;
    ripple.name = "selected-plot-outward-ripple";

    const boundary = new THREE.BufferGeometry();
    boundary.setAttribute("position", new THREE.Float32BufferAttribute(
      points.flatMap(([x, z]) => [x, height + 0.015, z]), 3,
    ));
    edge = new THREE.LineLoop(boundary, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.99,
      depthTest: true, depthWrite: false,
    }));
    edge.renderOrder = 26;
    edge.name = "selected-plot-white-focus-edge";

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(
      points.flatMap(([x, z]) => [x, height + 0.018, z]), 3,
    ));
    dots = new THREE.Points(pointGeometry, new THREE.PointsMaterial({
      color: 0xffffff, size: 4, sizeAttenuation: false,
      transparent: true, opacity: 0.99, depthTest: true, depthWrite: false,
    }));
    dots.renderOrder = 27;
    dots.name = "selected-plot-corner-markers";
    group.add(fill, halo, ripple, edge, dots);
  };

  const update = (now: number, reducedMotion: boolean) => {
    if (!selectedId || !fill || !halo || !ripple || !edge || !dots) return false;
    const frame = geoPlotFocusMotion(now, startedAt, reducedMotion);
    (fill.material as THREE.MeshBasicMaterial).opacity = frame.fillOpacity;
    (halo.material as THREE.MeshBasicMaterial).opacity = frame.haloOpacity;
    (edge.material as THREE.LineBasicMaterial).opacity = frame.edgeOpacity;
    (dots.material as THREE.PointsMaterial).opacity = frame.dotsOpacity;
    (ripple.material as THREE.MeshBasicMaterial).opacity = frame.rippleOpacity;
    ripple.scale.set(frame.rippleScale, 1, frame.rippleScale);
    return frame.animate;
  };
  const dispose = () => { clear(); group.removeFromParent(); };
  return { group, select, setAccent, update, dispose,
    get selectedId() { return selectedId; } };
}
