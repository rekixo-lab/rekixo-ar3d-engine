// Source-backed, draft-only masterplan CSV review. Never approves or remaps an existing polygon.
const ROLES=["front","back","depthA","depthB"];
const DIRECTIONS=new Set(["north","north-east","east","south-east","south","south-west","west","north-west"]);
const ALIAS={n:"north",ne:"north-east",e:"east",se:"south-east",s:"south",sw:"south-west",w:"west",nw:"north-west"};
const key=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const own=(row,...names)=>names.map(n=>row[key(n)]).find(v=>v!==undefined);
const freshSide=()=>({edges:[],length:0,unit:"ft",roadFacing:false,source:"",verified:false});
function parseRows(source){
  if(typeof source!=="string"||source.length>2000000)throw Error("CSV must be under 2 MB.");
  const result=[];let row=[],cell="",quoted=false;
  source=source.replace(/^\uFEFF/,"");
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}
      else if(c==='"')quoted=false;else cell+=c;continue;}
    if(c==='"'){if(cell!=="")throw Error("Unexpected CSV quote.");quoted=true;continue;}
    if(c===","){row.push(cell);cell="";continue;}
    if(c==="\n"||c==="\r"){if(c==="\r"&&source[i+1]==="\n")i++;
      row.push(cell);if(row.some(value=>value.trim()))result.push(row);row=[];cell="";continue;}
    cell+=c;
  }
  if(quoted)throw Error("Unclosed CSV quote.");
  row.push(cell);if(row.some(value=>value.trim()))result.push(row);
  if(result.length<2||result.length>2501)throw Error("CSV needs a header and 1–2500 plots.");
  const headers=result.shift().map(key);
  if(new Set(headers).size!==headers.length)throw Error("Duplicate CSV headings.");
  if(!headers.some(h=>["plotid","plotno","plotnumber","plot","id"].includes(h)))
    throw Error("CSV requires Plot ID / Plot No column.");
  return result.map((values,i)=>{
    if(values.length>headers.length)throw Error("CSV row "+(i+2)+" has too many columns.");
    return Object.fromEntries(headers.map((h,index)=>[h,(values[index]||"").trim()]));
  });
}
function amount(raw,label,id){
  if(raw===undefined||raw==="")return undefined;
  const digits=raw.replace(/,/g,"").trim();
  const feet=digits.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*["”]?)?$/);
  const value=feet?Number(feet[1])+Number(feet[2]||0)/12:Number(digits);
  if(!Number.isFinite(value)||value<=0||value>1e7)throw Error("Plot "+id+": invalid "+label+" measurement.");
  return value;
}
function cornersOf(raw,id){
  if(!raw)return null;
  let value;try{value=JSON.parse(raw);}catch{throw Error("Plot "+id+": invalid corners JSON.");}
  if(!Array.isArray(value)||value.length<3||value.length>80||
      !value.every(p=>Array.isArray(p)&&p.length===2&&
        p.every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1)))
    throw Error("Plot "+id+": corners must have 3–80 valid normalized pairs.");
  return value;
}
function basePlot(id,corners){
  const sides={};if(corners.length>=3){
    const roleCount=corners.length===3?3:4;
    const names=roleCount===3?["front","depthA","back"]:["front","depthA","back","depthB"];
    names.forEach((role,i)=>sides[role]={...freshSide(),
      edges:i===names.length-1?Array.from({length:corners.length-i},(_,n)=>i+n):[i]});
  }
  return {id,corners,layout:corners.length===3?"three":"four",sides,
    area:{value:0,unit:"sqft",source:"",verified:false},
    facing:"north",facingSource:"",facingVerified:false,road:"",notes:""};
}
function inspect(row,plot,issues){
  const original=JSON.stringify(plot);
  const id=plot.id;
  const area=amount(own(row,"area","plotarea","areasqft"),"area",id);
  if(area!==undefined&&area!==plot.area.value)plot.area={...plot.area,value:area,verified:false};
  const unit=own(row,"areaUnit");
  if(unit&&["sqft","sqm","sqyd"].includes(unit)&&unit!==plot.area.unit)
    plot.area={...plot.area,unit,verified:false};
  const as=own(row,"areaSource");if(as!==undefined&&as!==plot.area.source)
    plot.area={...plot.area,source:as,verified:false};
  const rawFacing=own(row,"facing","plotfacing");
  if(rawFacing){
    const normalized=rawFacing.toLowerCase().replace(/\s+/g,"-");
    const direction=ALIAS[normalized]||normalized;
    if(!DIRECTIONS.has(direction))issues.push(id+": unrecognized facing "+rawFacing);
    else if(direction!==plot.facing){plot.facing=direction;plot.facingVerified=false;}
  }
  for(const [field,cols] of [["facingSource",["facingSource"]],["road",["road","roadwidth"]],
    ["notes",["notes","remark"]]]){
    const value=own(row,...cols);
    if(value!==undefined&&value!==plot[field]){
      plot[field]=value;if(field!=="notes")plot.facingVerified=false;
    }
  }
  for(const role of ROLES){
    if(role==="depthB"&&plot.corners.length===3)continue;
    const roleName=role==="depthA"?"depth":role;
    const raw=own(row,role+"Length",role,roleName,roleName+"Length");
    const side={...(plot.sides[role]||freshSide())};
    const length=amount(raw,role,id);
    if(length!==undefined&&length!==side.length){side.length=length;side.verified=false;}
    const source=own(row,role+"Source");
    if(source!==undefined&&source!==side.source){side.source=source;side.verified=false;}
    const unit=own(row,role+"Unit");
    if(unit&&["ft","m"].includes(unit)&&unit!==side.unit){side.unit=unit;side.verified=false;}
    const edges=own(row,role+"Edges");
    if(edges){
      const parsed=edges.split(/[|,]/).map(Number);
      if(parsed.every(v=>Number.isInteger(v)&&v>=0&&v<plot.corners.length)){
        if(JSON.stringify(parsed)!==JSON.stringify(side.edges)){
          side.edges=parsed;side.verified=false;side.roadFacing=false;
        }
      }else issues.push(id+": invalid "+role+" edge indices");
    }
    plot.sides[role]=side;
  }
  if(JSON.stringify(plot)!==original){
    plot.area.verified=false;plot.facingVerified=false;
    for(const side of Object.values(plot.sides))side.verified=false;
    return true;
  }
  return false;
}
function quality(row,plot,issues){
  const id=plot.id;
  if(!plot.area.value)issues.push(id+": missing area");
  if(!own(row,"facing","plotfacing")&&!plot.facingVerified)issues.push(id+": facing needs review");
  for(const role of ROLES){
    if(role==="depthB"&&plot.corners.length===3)continue;
    if(!(plot.sides[role]?.length>0))issues.push(id+": missing "+role);
  }
}
export function reviewMasterplanCsv(raw,currentPlots){
  const rows=parseRows(raw);const prior=new Map(currentPlots.map(p=>[p.id.toLowerCase(),p]));
  const known=new Set(),plots=currentPlots.map(p=>structuredClone(p));
  const indexed=new Map(plots.map((p,i)=>[p.id.toLowerCase(),i]));
  const added=[],changed=[],unmapped=[],issues=[];
  for(const row of rows){
    const id=String(own(row,"plotId","plotNo","plotNumber","plot","id")||"").trim();
    if(!id||id.length>80)throw Error("CSV has an empty/invalid Plot ID.");
    const lower=id.toLowerCase();
    if(known.has(lower))throw Error("Duplicate CSV Plot ID: "+id);
    known.add(lower);
    const corners=cornersOf(own(row,"cornersJSON","corners"),id);
    const old=prior.get(lower);
    if(old&&corners&&JSON.stringify(corners)!==JSON.stringify(old.corners))
      throw Error("Plot "+id+": imported corners differ. Existing mapping cannot be overwritten by CSV.");
    if(!old&&!corners){unmapped.push(id);continue;}
    const plot=old?structuredClone(old):basePlot(id,corners);
    if(inspect(row,plot,issues)){if(old)changed.push(id);}
    if(!old)added.push(id);
    quality(row,plot,issues);
    if(indexed.has(lower))plots[indexed.get(lower)]=plot;
    else{indexed.set(lower,plots.length);plots.push(plot);}
  }
  const missing=currentPlots.filter(p=>!known.has(p.id.toLowerCase())).map(p=>p.id);
  return {plots,added,changed,unmapped,missing,issues,rowCount:rows.length};
}
export function invalidateMasterplanSourceProof(draft){
  return {...draft,verifiedRevision:null,
    controlPoints:draft.controlPoints.map(p=>({...p,verified:false})),
    plots:draft.plots.map(p=>({...p,area:{...p.area,verified:false},
      facingVerified:false,
      sides:Object.fromEntries(Object.entries(p.sides).map(([key,side])=>[key,{...side,verified:false}]))}))};
}
const SCHEMA="rekixo-masterplan-local-draft-v1";
export function packMasterplanRecovery(value){
  return JSON.stringify({...value,schema:SCHEMA,savedAt:new Date().toISOString()});
}
export function unpackMasterplanRecovery(raw,scope){
  if(!raw||raw.length>4500000)return null;
  try{
    const v=JSON.parse(raw);
    if(v.schema!==SCHEMA||v.projectSlug!==scope.projectSlug||
      v.revision!==scope.revision||v.imageAssetId!==scope.imageAssetId||
      !v.draft||!Array.isArray(v.draft.plots)||!Array.isArray(v.draft.controlPoints)||
      !Array.isArray(v.draft.plots)||v.draft.plots.length>2500||
      v.draft.imageAssetId!==scope.imageAssetId)return null;
    return v;
  }catch{return null;}
}
