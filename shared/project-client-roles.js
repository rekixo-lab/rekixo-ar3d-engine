// Explicit project scope. No scope grants owner capabilities or cross-project data.
export const PROJECT_CLIENT_ROLES=Object.freeze(["viewer","editor","approver","client_admin"]);
const grants={
  viewer:["project.read","commercial.read"],
  editor:["project.read","commercial.read","commercial.prepare"],
  approver:["project.read","commercial.read","commercial.prepare","commercial.approve"],
  client_admin:["project.read","commercial.read","commercial.prepare","commercial.approve"]
};
export function canProjectClient(role,permission){
  return Object.hasOwn(grants,role)&&grants[role].includes(permission);
}
export function requireProjectClient(role,permission){
  if(!canProjectClient(role,permission))
    throw Error("Project role is not authorized to "+permission+".");
}
