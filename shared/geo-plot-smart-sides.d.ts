export type FrontFirstRole="front"|"depthA"|"back"|"depthB";
export type FrontFirstSideGroups={
  layout:"three"|"four";
  roles:Partial<Record<FrontFirstRole,number[]>>;
  reviewRequired:boolean;
};
export function inferFrontFirstSideGroups(
  corners:readonly (readonly [number,number])[],
  angleToleranceDeg?:number
):FrontFirstSideGroups|null;
export function roadFrontPreview<T extends {
  corners:[number,number][];
  sides:Partial<Record<"front",{edges:number[]}>>;
}>(
  plot:T|null|undefined,
  headingDeg:number,
  geoFacingSuggest:(corners:[number,number][],edges:number[],headingDeg:number)=>string|null
):string|null;
