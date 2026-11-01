import type {SimilarityTransform} from "./geo-plot-image-alignment.js";
import type {BasicGeoPlot} from "./geo-plot-stage3-review.js";
export function stageVerifiedImageCorner<T extends BasicGeoPlot>(
  plots:readonly T[],plotId:string,cornerIndex:number,imageUv:[number,number],
  transform:SimilarityTransform):{plots:T[];plotId:string;cornerIndex:number;modelPoint:number[]};
