export type GeoPlotQualityIssue={
  severity:"blocker"|"review";
  plotId:string;
  field:string;
  reason:string;
};
export type GeoPlotQualityQueueEntry={
  id:string;
  blockers:number;
  reviews:number;
  issues:GeoPlotQualityIssue[];
  primaryField:string;
  nextAction:string;
};
export function geoPlotReviewQueue(plots:readonly {id:string}[],issues:readonly GeoPlotQualityIssue[]):{
  queue:GeoPlotQualityQueueEntry[];
  general:GeoPlotQualityIssue[];
  affected:number;
  blockedPlots:number;
  reviewPlots:number;
};
export function geoPlotReviewFieldAction(field:string):string;
