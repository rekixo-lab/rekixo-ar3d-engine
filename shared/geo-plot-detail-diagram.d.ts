export interface PublicGeoPlotSide {
  edges?: number[];
  length: number;
  unit: string;
  roadFacing: boolean;
}
export interface PublicGeoPlotForDiagram {
  corners: Array<[number, number]>;
  layout?: "three" | "four";
  sides: Record<string, PublicGeoPlotSide>;
}
export interface PublicGeoDiagramSegment {
  x1: number; y1: number; x2: number; y2: number; length: number;
}
export interface PublicGeoDiagramSide extends PublicGeoPlotSide {
  role: string;
  label: string;
  color: string;
  segments: PublicGeoDiagramSegment[];
  labelX: number | null;
  labelY: number | null;
}
export interface PublicGeoDiagram {
  pointText: string;
  vertexCount: number;
  sides: PublicGeoDiagramSide[];
}
export function publicGeoPlotDiagram(plot: PublicGeoPlotForDiagram): PublicGeoDiagram | null;
export function publicGeoAreaUnits(
  area: {value:number;unit:string} | null | undefined,
): Array<{unit:"sqft"|"sqm"|"sqyd";label:string;value:number}>;
