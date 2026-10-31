export type InventoryReviewIssue={plotId:string;field:string;reason:string};
export function geoInventoryReviewIssues(
 plots:ReadonlyArray<{id:string;area?:{value:number;unit:string;source:string};
 sides?:Partial<Record<"front"|"back"|"depthA"|"depthB",{length:number;unit:string;source:string}>>;
 facing?:string;facingSource?:string;road?:string}>,
 rows:ReadonlyArray<{id:string;area:number;areaUnit:string;areaSource:string;
 front:number;back:number;depthA:number;depthB:number;lengthUnit:string;
 measurementSource:string;facing:string;facingSource:string;road:string}>
):InventoryReviewIssue[];
