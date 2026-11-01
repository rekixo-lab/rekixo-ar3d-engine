export type PublishDiff={schema:string;liveCount:number;draftCount:number;added:number;removed:number;changed:number;
  approvalRequired:string[];changes:Array<{plotId:string;kind:"added"|"changed"|"removed";fields:string[];requiresReapproval:boolean}>};
export function compareGeoPlotPublication<T extends {id:string}>(draftPlots:readonly T[],livePlots:readonly T[]):PublishDiff;
