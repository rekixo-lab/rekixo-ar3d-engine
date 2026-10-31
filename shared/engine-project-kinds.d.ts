export type EngineProjectKind = "legacy" | "building" | "building_geo" | "masterplan_geo";
export const ENGINE_PROJECT_KINDS: readonly EngineProjectKind[];
export const PROJECT_KIND_LABELS: Readonly<Record<EngineProjectKind,string>>;
export function isEngineProjectKind(kind: unknown): kind is EngineProjectKind;
export function selectedProjectKind(kind: unknown): EngineProjectKind;
export function newProjectStartPath(kind: EngineProjectKind): "masterplan" | "source-pack";
export function projectModuleVisible(kind: EngineProjectKind, module: string): boolean;
export function projectKindAllowsCloudRoute(kind: EngineProjectKind | unknown, route: string): boolean;
