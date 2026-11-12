export type GeoExploreBounds={min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}};
export type GeoExploreView="full"|"top"|"aerial"|"close";
export type GeoExploreCameraShot={
  position:{x:number;y:number;z:number};
  target:{x:number;y:number;z:number};
  fov:number;minDistance:number;maxDistance:number;boundsRadius:number;
};
export function geoExploreCameraShot(
  bounds:GeoExploreBounds,aspect:number,view?:GeoExploreView
):GeoExploreCameraShot|null;
