export type ProjectClientRole="viewer"|"editor"|"approver"|"client_admin";
export const PROJECT_CLIENT_ROLES:ReadonlyArray<ProjectClientRole>;
export function canProjectClient(role:string,permission:string):boolean;
export function requireProjectClient(role:string,permission:string):void;
