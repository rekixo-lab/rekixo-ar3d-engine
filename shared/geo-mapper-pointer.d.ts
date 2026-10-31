export type ModelPoint=readonly [number,number];
export type SnapKind="none"|"vertex"|"edge";
export type SnapResult={point:ModelPoint;screen:ModelPoint;distance:number;kind:SnapKind};
export function precisionSnap(raw:ModelPoint,screen:ModelPoint,
  rings:ReadonlyArray<{points:ReadonlyArray<ModelPoint>;skipIndex?:number}>,
  project:(point:ModelPoint)=>ModelPoint,
  options?:{enabled?:boolean;thresholdPx?:number}):SnapResult;
export function zoomAnchorDelta(before:ModelPoint|null,after:ModelPoint|null):ModelPoint|null;
export function isMappingTap(start:{x:number;y:number;id:number}|null,
  end:{x:number;y:number;id:number}|null,thresholdPx?:number):boolean;
