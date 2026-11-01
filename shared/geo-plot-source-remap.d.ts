import type {ImageModelAlignmentDraft} from "./geo-plot-image-alignment.js";
import type {BasicGeoPlot} from "./geo-plot-stage3-review.js";
export function geoSourceChangePlan<T extends BasicGeoPlot>(plots:ReadonlyArray<T>,
  previous:ImageModelAlignmentDraft,current:ImageModelAlignmentDraft,selectedIds?:string[]):{
    schema:string;advisoryOnly:boolean;oldGeoReleaseId:string;newGeoReleaseId:string;
    sameOriginalImageSha256:string;selectedCount:number;unreviewedIds:string[];
    rows:Array<{plotId:string;selected:boolean;maxModelCoordinateMovementM:number;
      beforeCorners:number[][];proposedCorners:number[][]}>;
  };
export function stageSelectedGeoSourceRemap<T extends BasicGeoPlot>(plots:ReadonlyArray<T>,
  previous:ImageModelAlignmentDraft,current:ImageModelAlignmentDraft,selectedIds?:string[]):{
    plots:T[];plan:ReturnType<typeof geoSourceChangePlan>;
  };
