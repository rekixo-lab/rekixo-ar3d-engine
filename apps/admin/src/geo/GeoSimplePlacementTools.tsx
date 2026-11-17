import { solveGeoGuidedRigidAlignment, type GeoGuidedRigidSolution } from "@rekixo/3d-engine-core";
import { useMemo, useState } from "react";
import type { GeoGuidedPairDraft, GeoGuidedFineDelta } from "./GeoGuidedRigidAlignment";
import type { GeoV2Anchor } from "./geoV2Api";

type Point = { latitude: number; longitude: number };
type Props = {
  coordinate: Point | null;
  anchor: GeoV2Anchor | null;
  pairs: GeoGuidedPairDraft[];
  scale: string;
  headingDeg: string;
  onScale(value: string): void;
  onApplyMeasuredFit(solution: GeoGuidedRigidSolution): void;
  onFineAdjust(delta: GeoGuidedFineDelta): void;
  onMatchPoints(): void;
};

export default function GeoSimplePlacementTools({
  coordinate, anchor, pairs, scale, headingDeg, onScale, onApplyMeasuredFit, onFineAdjust, onMatchPoints,
}: Props) {
  const [moveStep, setMoveStep] = useState(1);
  const currentScale = Number(scale);
  const validScale = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
  const count = pairs.filter((pair) => pair.source && pair.target).length;
  const fit = useMemo(() => {
    if (!coordinate || !anchor || count < 3) return null;
    try {
      const matched = pairs.flatMap((pair) => pair.source && pair.target
        ? [{ id: pair.id, source: pair.source, target: pair.target }] : []);
      const result = solveGeoGuidedRigidAlignment(
        coordinate, { x: anchor.xM, y: anchor.yM, z: anchor.zM },
        matched, { allowScale: true, allowExtendedScale: true },
      );
      return { errorM: result.maxErrorM, message: "", solution: result };
    } catch (error) {
      return {
        errorM: Number.POSITIVE_INFINITY,
        message: error instanceof Error ? error.message : "Selected points do not match.",
        solution: null,
      };
    }
  }, [coordinate, anchor, count, pairs]);

  return <section className="geo-v2-simple-tools" aria-label="Easy 3D model size and placement">
    <div className="geo-v2-simple-intro">
      <h4>Fit the 3D model to the site</h4>
      <p>Use these simple controls to adjust the model on the satellite map. Nothing is published automatically.</p>
    </div>
    {fit && (fit.errorM > 2 || fit.message) && <div className="geo-v2-simple-warning" role="alert">
      <strong>Selected corners do not match</strong>
      <p>{fit.message || `The selected 3D and satellite corners disagree by up to ${fit.errorM.toFixed(1)} m.`}
        {" "}Moving or shrinking alone will not fix incorrectly paired corners.</p>
      <button type="button" onClick={onMatchPoints}>Re-pick matching corners</button>
    </div>}
    {fit?.solution && fit.errorM <= 2 && <div className="geo-v2-simple-fit" role="status">
      <strong>Corner match is consistent (within {fit.errorM.toFixed(2)} m)</strong>
      <p>Suggested uniform size: {(fit.solution.scale * 100).toFixed(0)}%. Confirm the GLB units and real land boundaries before saving.</p>
      <button type="button" onClick={() => onApplyMeasuredFit(fit.solution!)}>Apply measured size, move and rotation</button>
    </div>}
    <div className="geo-v2-simple-section">
      <div className="geo-v2-simple-section-heading">
        <label htmlFor="geo-simple-scale">1. Model size</label>
        <strong>{(validScale * 100).toFixed(0)}%</strong>
      </div>
      <input id="geo-simple-scale" type="range" aria-label="Model size on satellite map"
        min="0.05" max="3" step="0.01"
        value={Math.min(3, Math.max(0.05, validScale))}
        disabled={!coordinate || !anchor}
        onChange={(event) => onScale(event.target.value)}/>
      <div className="geo-v2-simple-action-grid">
        <button type="button" onClick={() => onFineAdjust({ scaleMultiplier: 0.5 })}>Half size</button>
        <button type="button" onClick={() => onFineAdjust({ scaleMultiplier: 0.9 })}>−10%</button>
        <button type="button" onClick={() => onFineAdjust({ scaleMultiplier: 1.1 })}>+10%</button>
        <button type="button" onClick={() => onFineAdjust({ scaleMultiplier: 2 })}>Double</button>
      </div>
      <small>This changes the actual ground scale uniformly, not camera zoom. Check real site measurements before publishing.</small>
    </div>
    <div className="geo-v2-simple-section">
      <div className="geo-v2-simple-section-heading">
        <strong>2. Move the model</strong>
        <select value={moveStep} aria-label="Move distance" onChange={(event) => setMoveStep(Number(event.target.value))}>
          <option value={0.25}>Fine · 0.25 m</option>
          <option value={1}>Normal · 1 m</option>
          <option value={5}>Fast · 5 m</option>
        </select>
      </div>
      <div className="geo-v2-simple-move-grid" aria-label="Move model">
        <button type="button" className="geo-v2-move-n" onClick={() => onFineAdjust({northM:moveStep})}>↑ North</button>
        <button type="button" className="geo-v2-move-w" onClick={() => onFineAdjust({eastM:-moveStep})}>← West</button>
        <button type="button" className="geo-v2-move-e" onClick={() => onFineAdjust({eastM:moveStep})}>East →</button>
        <button type="button" className="geo-v2-move-s" onClick={() => onFineAdjust({northM:-moveStep})}>↓ South</button>
      </div>
    </div>
    <div className="geo-v2-simple-section">
      <div className="geo-v2-simple-section-heading"><strong>3. Rotate</strong><span>{Number(headingDeg || 0).toFixed(2)}°</span></div>
      <div className="geo-v2-simple-action-grid geo-v2-simple-action-grid--two">
        <button type="button" onClick={() => onFineAdjust({ headingDeg:-1 })}>↶ −1°</button>
        <button type="button" onClick={() => onFineAdjust({ headingDeg:1 })}>+1° ↷</button>
      </div>
    </div>
    <button type="button" className="geo-v2-simple-match-button" onClick={onMatchPoints}>Match 3D corners to satellite corners</button>
    <p className="geo-v2-simple-tip">The editor changes only the unsaved placement. Save Draft, Verify and Publish remain separate steps. Incorrect map corners must be fixed before publishing.</p>
  </section>;
}
