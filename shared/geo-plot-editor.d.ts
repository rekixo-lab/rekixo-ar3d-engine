export type EditorPoint=readonly [number,number];
export type EditorPlot={id:string;corners?:EditorPoint[];area?:{value?:number;source?:string};road?:string;notes?:string;planeSource?:string;facingSource?:string;sides?:Record<string,{verified?:boolean;length?:number}|undefined>};
export function nextFreePlotId<T extends {id:string}>(plots:ReadonlyArray<T>):string;
export function adjacentPlot<T extends {id:string}>(plots:ReadonlyArray<T>,currentId:string,direction:1|-1):T|null;
export function hasPendingPlotEdits(working:EditorPlot|null,saved:EditorPlot|undefined|null):boolean;
export function isTextEditingTarget(target:EventTarget|null):boolean;
export function boundedZoom(current:number,multiplier:number):number;
export function sideLabelAnchor(corners:ReadonlyArray<EditorPoint>,edges:ReadonlyArray<number>):[number,number]|null;
