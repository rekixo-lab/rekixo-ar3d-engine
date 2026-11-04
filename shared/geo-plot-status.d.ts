export type GeoPlotStatus="available"|"booked"|"sold";
export declare const GEO_PLOT_STATUS_VALUES:readonly GeoPlotStatus[];
export declare const GEO_PLOT_STATUS_COLORS:Readonly<Record<GeoPlotStatus,number>>;

export type GeoPlotStatusSummary={
  total:number;available:number;booked:number;sold:number;
  approved:number;pending:number;statusById:Readonly<Record<string,GeoPlotStatus>>;
};
export declare function summarizeApprovedGeoPlotStatuses(mapping:{
  publicationMode?:"verified"|"preliminary";
  plots:ReadonlyArray<{id:string}>;
  commercial?:Record<string,{status:GeoPlotStatus}|undefined>;
}|null|undefined):GeoPlotStatusSummary;
