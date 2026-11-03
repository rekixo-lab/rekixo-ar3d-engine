export type MasterplanCsvReview<T>={plots:T[];added:string[];changed:string[];
  unmapped:string[];missing:string[];issues:string[];rowCount:number};
export function reviewMasterplanCsv<T extends {id:string}>(raw:string,currentPlots:T[]):MasterplanCsvReview<T>;
export function invalidateMasterplanSourceProof<T extends {verifiedRevision:number|null;
  controlPoints:Array<{verified:boolean}>;plots:Array<{area:{verified:boolean};
  facingVerified:boolean;sides:Record<string,{verified:boolean}>}>}>(draft:T):T;
export function packMasterplanRecovery(value:object):string;
export function unpackMasterplanRecovery<T=unknown>(raw:string|null,scope:{
  projectSlug:string;revision:number;imageAssetId:string|null}):T|null;
