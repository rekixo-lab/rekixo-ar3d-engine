export type GeoPlotRole="front"|"depthA"|"back"|"depthB";
export type GeoSidePlot={
  corners:readonly (readonly [number,number])[];
  layout:"three"|"four";
  sides:Partial<Record<GeoPlotRole,{edges:number[]}>>;
};
export type GeoSideCoverage={
  ok:boolean;
  edgeCount:number;
  roles:GeoPlotRole[];
  owners:GeoPlotRole[][];
  missingEdges:number[];
  duplicateEdges:number[];
  invalidEdges:Array<{role:GeoPlotRole;edge:unknown}>;
  missingRoles:GeoPlotRole[];
  disconnectedRoles:GeoPlotRole[];
};
export function inspectGeoPlotSideCoverage<T extends GeoSidePlot>(plot:T|null|undefined):GeoSideCoverage;
export function assignCoveredGeoPlotEdge<T extends GeoSidePlot>(
  plot:T,role:GeoPlotRole,edge:number,options?:{extend?:boolean}
):T;
export function repairGeoPlotSideCoverage<T extends GeoSidePlot>(plot:T):T;
