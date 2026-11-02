export interface GeoOrbitFinger {
  identifier:number;
  clientX:number;
  clientY:number;
}
export interface GeoOrbitTouchEvent {
  touches:ArrayLike<GeoOrbitFinger>;
  target:EventTarget|null;
  cancelable:boolean;
  preventDefault():void;
  stopPropagation():void;
}
export interface GeoOrbitController {
  onTouchStart(event:GeoOrbitTouchEvent):void;
  onTouchMove(event:GeoOrbitTouchEvent):void;
  onTouchEnd(event:GeoOrbitTouchEvent):void;
  onTouchCancel(event:GeoOrbitTouchEvent):void;
  suppressClick():boolean;
  destroy():void;
}
export function normalizeGeoOrbitHeading(value:number):number;
export function createGeoOneFingerOrbit(options:{
  getHeading:()=>number;
  setHeading:(heading:number)=>void;
  onRotate?:()=>void;
  onCaptureChange?:(capturing:boolean)=>void;
  shouldIgnoreTarget?:(target:EventTarget|null)=>boolean;
  now?:()=>number;
}):GeoOrbitController;
