import {
  solveGeoGuidedRigidAlignment,
  type GeoGuidedLatLng,
  type GeoGuidedRigidSolution,
  type GeoGuidedSourcePoint,
} from "@rekixo/3d-engine-core";
import { useEffect, useMemo, useState } from "react";
import GeoBuildingTopReference from "./GeoBuildingTopReference";
import type { GeoV2Anchor } from "./geoV2Api";

export type GeoGuidedPairDraft = {
  id: string;
  label: string;
  source: GeoGuidedSourcePoint | null;
  target: GeoGuidedLatLng | null;
};

export type GeoGuidedFineDelta = {
  eastM?: number;
  northM?: number;
  verticalM?: number;
  headingDeg?: number;
  scaleMultiplier?: number;
};

type Props = {
  modelUrl: string | null;
  modelName: string;
  coordinate: GeoGuidedLatLng | null;
  anchor: GeoV2Anchor | null;
  pairs: GeoGuidedPairDraft[];
  activeSourceId: string | null;
  activeTargetId: string | null;
  allowScale: boolean;
  onActivateSource(pointId: string | null): void;
  onActivateTarget(pointId: string | null): void;
  onSourceCapture(pointId: string, point: GeoGuidedSourcePoint): void;
  onClearPair(pointId: string): void;
  onAllowScaleChange(value: boolean): void;
  onApply(solution: GeoGuidedRigidSolution): void;
  onFineAdjust(delta: GeoGuidedFineDelta): void;
};

function formatMeters(value: number) {
  if (value < 0.01) return `${(value * 1000).toFixed(1)} mm`;
  if (value < 1) return `${(value * 100).toFixed(1)} cm`;
  return `${value.toFixed(3)} m`;
}

function pointSummary(point: GeoGuidedSourcePoint | null) {
  if (!point) return "Not picked";
  return `X ${point.x.toFixed(3)} · Z ${point.z.toFixed(3)} m`;
}

function targetSummary(point: GeoGuidedLatLng | null) {
  if (!point) return "Not picked";
  return `${point.latitude.toFixed(7)}, ${point.longitude.toFixed(7)}`;
}

function solutionQuality(solution: GeoGuidedRigidSolution | null) {
  if (!solution) return { label: "Waiting for paired points", className: "" };
  if (solution.maxErrorM <= 0.25)
    return { label: "Excellent fit", className: " geo-v2-guided-quality--excellent" };
  if (solution.maxErrorM <= 0.75)
    return { label: "Good fit", className: " geo-v2-guided-quality--good" };
  if (solution.maxErrorM <= 2)
    return { label: "Review fit", className: " geo-v2-guided-quality--review" };
  return { label: "Poor fit · recheck points", className: " geo-v2-guided-quality--poor" };
}

export default function GeoGuidedRigidAlignment({
  modelUrl,
  modelName,
  coordinate,
  anchor,
  pairs,
  activeSourceId,
  activeTargetId,
  allowScale,
  onActivateSource,
  onActivateTarget,
  onSourceCapture,
  onClearPair,
  onAllowScaleChange,
  onApply,
  onFineAdjust,
}: Props) {
  const [coarse, setCoarse] = useState(false);
  const [allowExtendedScale, setAllowExtendedScale] = useState(false);
  // Any newly selected corner/source invalidates previous measurement review.
  useEffect(() => setAllowExtendedScale(false), [pairs, modelUrl, anchor?.id]);
  const completePairs = useMemo(
    () => pairs.flatMap((pair) => pair.source && pair.target
      ? [{ id: pair.id, source: pair.source, target: pair.target }]
      : []),
    [pairs],
  );

  const solveState = useMemo(() => {
    if (!coordinate) return { solution: null, error: "Set WGS84 site anchor first." };
    if (!anchor) return { solution: null, error: "Select explicit Building model anchor first." };
    if (completePairs.length < 2)
      return { solution: null, error: "Pair at least P1 and P2. P3/P4 improve validation." };
    try {
      return {
        solution: solveGeoGuidedRigidAlignment(
          coordinate,
          { x: anchor.xM, y: anchor.yM, z: anchor.zM },
          completePairs,
          { allowScale, allowExtendedScale },
        ),
        error: "",
      };
    } catch (reason) {
      return {
        solution: null,
        error: reason instanceof Error ? reason.message : "Guided rigid solve failed.",
      };
    }
  }, [coordinate, anchor, completePairs, allowScale, allowExtendedScale]);

  // Show the best-fit measured scale even if the legacy safe envelope blocks
  // applying it. This is a diagnostic, not an automatic source conversion.
  const extendedEstimate = useMemo(() => {
    if (!coordinate || !anchor || !allowScale || allowExtendedScale ||
        completePairs.length < 3 || solveState.solution) return null;
    try {
      const estimate = solveGeoGuidedRigidAlignment(
        coordinate, { x: anchor.xM, y: anchor.yM, z: anchor.zM },
        completePairs, { allowScale: true, allowExtendedScale: true },
      );
      return estimate.scale > 1.5 || estimate.scale < 0.5 ? estimate : null;
    } catch {
      return null;
    }
  }, [coordinate, anchor, completePairs, allowScale, allowExtendedScale, solveState.solution]);

  const quality = solveState.solution
    ? solutionQuality(solveState.solution)
    : {
        label: completePairs.length >= 2 ? "Alignment needs review" : "Waiting for paired points",
        className: completePairs.length >= 2 ? " geo-v2-guided-quality--review" : "",
      };
  const moveStep = coarse ? 1 : 0.25;
  const rotateStep = coarse ? 0.1 : 0.02;

  return (
    <aside className="geo-v2-guided-panel">
      <div className="geo-v2-guided-heading">
        <div>
          <span>GUIDED RIGID ALIGNMENT</span>
          <h4>4-point exact placement aid</h4>
        </div>
        <small>Rigid only · no Building warp</small>
      </div>

      <GeoBuildingTopReference
        modelUrl={modelUrl}
        modelName={modelName}
        points={pairs.map((pair) => ({ id: pair.id, label: pair.label, source: pair.source }))}
        activePointId={activeSourceId}
        onCapture={onSourceCapture}
      />

      <div className="geo-v2-guided-pairs">
        {pairs.map((pair, index) => {
          const required = index < 2;
          return (
            <article key={pair.id} className="geo-v2-guided-pair">
              <div className="geo-v2-guided-pair-title">
                <strong>{pair.label}</strong>
                <span>{required ? "required" : "validation"}</span>
              </div>
              <div className="geo-v2-guided-pair-actions">
                <button
                  type="button"
                  className={activeSourceId === pair.id ? "is-active" : ""}
                  disabled={!modelUrl}
                  onClick={() => {
                    onActivateTarget(null);
                    onActivateSource(activeSourceId === pair.id ? null : pair.id);
                  }}
                >
                  {pair.source ? "Re-pick Building" : "Pick Building"}
                </button>
                <button
                  type="button"
                  className={activeTargetId === pair.id ? "is-active" : ""}
                  disabled={!coordinate || !pair.source}
                  onClick={() => {
                    onActivateSource(null);
                    onActivateTarget(activeTargetId === pair.id ? null : pair.id);
                  }}
                >
                  {pair.target ? "Re-pick Map" : "Pick Map"}
                </button>
                <button
                  type="button"
                  className="geo-v2-guided-clear"
                  disabled={!pair.source && !pair.target}
                  onClick={() => onClearPair(pair.id)}
                >
                  Clear
                </button>
              </div>
              <small><b>Building:</b> {pointSummary(pair.source)}</small>
              <small><b>Map:</b> {targetSummary(pair.target)}</small>
            </article>
          );
        })}
      </div>

      <label className="geo-v2-guided-scale-toggle">
        <input
          type="checkbox"
          checked={allowScale}
          onChange={(event) => {
            onAllowScaleChange(event.target.checked);
            if (!event.target.checked) setAllowExtendedScale(false);
          }}
        />
        <span>
          <strong>Allow uniform scale solve</strong>
          <small>OFF recommended. When enabled, scale is constrained to 0.5–1.5; shear/non-uniform scaling stays impossible.</small>
        </span>
      </label>

      {allowScale && completePairs.length >= 3 && (
        <label className="geo-v2-guided-scale-toggle geo-v2-guided-extended-review">
          <input
            type="checkbox"
            checked={allowExtendedScale}
            onChange={(event) => setAllowExtendedScale(event.target.checked)}
          />
          <span>
            <strong>Reviewed site measurements · permit 0.1–5× scale</strong>
            <small>Only check after comparing real plot dimensions and the canonical FBX/GLB units. This never changes model geometry. Requires 3+ pairs, residual review and manual Save → Verify → Publish.</small>
          </span>
        </label>
      )}

      <div className={`geo-v2-guided-quality${quality.className}`}>
        <strong>{quality.label}</strong>
        {solveState.solution ? (
          <div className="geo-v2-guided-diagnostics">
            <span><b>{solveState.solution.pointCount}</b> paired</span>
            <span>RMS <b>{formatMeters(solveState.solution.rmsErrorM)}</b></span>
            <span>Max <b>{formatMeters(solveState.solution.maxErrorM)}</b></span>
            <span>Worst <b>{solveState.solution.worstPointId || "—"}</b></span>
            <span>Heading <b>{solveState.solution.headingDeg.toFixed(4)}°</b></span>
            <span>Scale <b>{solveState.solution.scale.toFixed(6)}</b></span>
          </div>
        ) : (
          <div className="geo-v2-guided-scale-diagnostics" role="alert">
            <small>{solveState.error}</small>
            {extendedEstimate && (
              <div>
                <strong>Measured best fit: {extendedEstimate.scale.toFixed(3)}×</strong>
                <span>RMS {formatMeters(extendedEstimate.rmsErrorM)} · Max {formatMeters(extendedEstimate.maxErrorM)}</span>
                <span>This exceeds the default 0.5–1.5× limit. Compare measured site size and source units, then explicitly check reviewed scale above.</span>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="geo-v2-guided-apply"
        disabled={!solveState.solution || (completePairs.length >= 3 && solveState.solution.maxErrorM > 2)}
        onClick={() => {
          if (solveState.solution && (completePairs.length < 3 || solveState.solution.maxErrorM <= 2))
            onApply(solveState.solution);
        }}
      >
        Apply rigid solution to current form
      </button>
      {solveState.solution && allowExtendedScale && solveState.solution.maxErrorM <= 2 &&
        <p role="status" className="geo-v2-variant-note">Extended uniform scale is provisional until real site measurements and source-model units have been independently checked. Applying changes only the unsaved form.</p>}
      {solveState.solution && completePairs.length >= 3 && solveState.solution.maxErrorM > 2 &&
        <p role="alert" className="geo-v2-variant-note">Fit has more than 2 metres of residual error. Recheck site corners and source scale before applying.</p>}
      <p className="geo-v2-guided-help">
        Apply only updates the unsaved Geo form. Nothing is written or published until the normal Save → Verify → Publish gates are completed.
      </p>

      <div className="geo-v2-guided-fine">
        <div className="geo-v2-guided-fine-head">
          <div><strong>Fine alignment</strong><small>Current form only · live map preview</small></div>
          <label><input type="checkbox" checked={coarse} onChange={(event) => setCoarse(event.target.checked)} /> Coarse</label>
        </div>
        <div className="geo-v2-guided-fine-grid">
          <button type="button" onClick={() => onFineAdjust({ northM: moveStep })}>N +{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ eastM: -moveStep })}>W −{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ eastM: moveStep })}>E +{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ northM: -moveStep })}>S −{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ verticalM: moveStep })}>Up +{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ verticalM: -moveStep })}>Down −{moveStep}m</button>
          <button type="button" onClick={() => onFineAdjust({ headingDeg: -rotateStep })}>Rotate −{rotateStep}°</button>
          <button type="button" onClick={() => onFineAdjust({ headingDeg: rotateStep })}>Rotate +{rotateStep}°</button>
          <button type="button" disabled={!allowScale} onClick={() => onFineAdjust({ scaleMultiplier: 0.999 })}>Scale −0.1%</button>
          <button type="button" disabled={!allowScale} onClick={() => onFineAdjust({ scaleMultiplier: 1.001 })}>Scale +0.1%</button>
        </div>
      </div>
    </aside>
  );
}
