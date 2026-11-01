export type BasicGeoPlot={id:string;corners:[number,number][];
  sides:Partial<Record<"front"|"back"|"depthA"|"depthB",{edges:number[];length:number;unit:"m"|"ft";source:string;verified:boolean;roadFacing:boolean}>>;
  area:{value:number;unit:"sqm"|"sqft"|"sqyd";source:string;verified:boolean};
  facing:string;facingSource:string;facingVerified:boolean;road:string;
  planeY?:number;planeSource?:string;planeVerified?:boolean;notes:string;layout:"three"|"four"};
export type BasicInventory={id:string;area:number;areaUnit:string;areaSource:string;front:number;back:number;
  depthA:number;depthB:number;lengthUnit:string;measurementSource:string;road:string;facing:string;facingSource:string;dimensions:string;notes:string};
export function cloneUnverifiedGeoPlot<P extends BasicGeoPlot>(previous:P,newId:string,dx:number,dz:number,
  inventoryRows:readonly BasicInventory[],existing:readonly P[]):P;
export function geoPlotEvidenceManifest(plots:readonly BasicGeoPlot[],inventoryRows:readonly BasicInventory[],
  geoScale?:number,revision?:{inventoryRevision?:number;mappingRevision?:number;alignmentRevision?:number}):any;
export function geoPlotQualityReport(plots:readonly BasicGeoPlot[],inventoryRows?:readonly BasicInventory[],options?:{
  geoScale?:number;mappingStale?:boolean;alignmentStale?:boolean;alignmentRevision?:number;
  verifiedAlignmentRevision?:number|null;alignmentIssueCount?:number;
  inventoryRevision?:number;verifiedInventoryRevision?:number|null;}):{
    schema:string;advisoryOnly:boolean;
    issues:Array<{severity:"blocker"|"review";plotId:string;field:string;reason:string}>;
    summary:{mapped:number;inventory:number;blockers:number;reviews:number}
  };