export type GeoPlotPublicationMode="verified"|"preliminary";
export function normalizeGeoPlotPublicationMode(value:unknown):GeoPlotPublicationMode;
export type PublicGeoPlotFacts={
  id:string;corners:Array<[number,number]>;layout?:string;planeY?:number;
  area:{value:number;unit:string}|null;
  facing:string|null;road:string|null;notes:string;
  sides:Record<string,{length:number;unit:string;roadFacing:boolean}>;
};
export function publicGeoPlotFacts(plot:{
  id:string;corners:Array<[number,number]>;layout?:string;planeY?:number;
  area:{value:number;unit:string;source?:string;verified?:boolean};
  facing:string;facingSource?:string;facingVerified?:boolean;
  sides:Record<string,{length:number;unit:string;roadFacing:boolean;source?:string;verified?:boolean}>;
  road?:string;notes?:string;
},mode:GeoPlotPublicationMode):PublicGeoPlotFacts;
export function preliminaryPublishPlotGuard(
  plots:readonly {id:string}[],approvedInventory:readonly {id:string}[]):true;
