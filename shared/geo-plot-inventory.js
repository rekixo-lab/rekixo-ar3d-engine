// Engine-owned, CSV-first Geo plot inventory. These are unapproved source facts,
// never the published/verified geometry or live commercial plot states.
export const GEO_INVENTORY_HEADERS = Object.freeze([
  "plotId","area","areaUnit","areaSource","front","back","depthA","depthB",
  "lengthUnit","measurementSource","road","facing","facingSource","dimensions","notes"
]);
const alias={
  plotId:["id","plotid","plotno","plotnumber","lotno","lotid"],
  area:["area","approvedarea"],areaUnit:["areaunit","areauom"],
  areaSource:["areasource","approvedareasource"],
  front:["front","frontlength"],back:["back","backlength"],
  depthA:["deptha","depth","depthalength","depthlength"],
  depthB:["depthb","depth2","depthblength","depth2length"],
  lengthUnit:["lengthunit","unit","dimensionunit","measurementunit"],
  measurementSource:["measurementsource","source","sourceref","measurementref"],
  road:["road","roadaccess"],facing:["facing","frontfacing"],
  facingSource:["facingsource"],dimensions:["dimensions","dimensiontext"],
  notes:["notes","remarks"],
  sqft:["sqft","sqfeet","sqftarea"],
  sqm:["sqm","sqmeter","sqmetre"],
  sqyd:["sqyd","sqyard"]
};
const normalizeHeader=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,"");
const trim=(v,max=240)=>String(v??"").trim().replace(/[\x00-\x1f\x7f]/g,"").slice(0,max);
const validId=id=>/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(id);
const positive=(input,label)=>{
  if(input===null||input===undefined||String(input).trim()==="")return 0;
  const text=String(input).trim();
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text))throw Error(label+" must be a numeric measurement.");
  const n=Number(text);
  if(!Number.isFinite(n)||n<0||n>1e7)throw Error(label+" must be zero or positive and finite.");
  return n;
};
export function parseGeoInventoryCsv(raw){
  if(typeof raw!=="string"||raw.length>2_000_000)throw Error("CSV must be smaller than 2 MB.");
  const lines=[];let field="",row=[],quoted=false;
  const commit=()=>{row.push(field);if(row.some(v=>v.trim()))lines.push(row);row=[];field="";};
  const value=raw.replace(/^\uFEFF/,"");
  for(let i=0;i<value.length;i++){
    const ch=value[i];
    if(ch==='"'){
      if(quoted&&value[i+1]==='"'){field+='"';i++;}
      else if(quoted)quoted=false;
      else if(!field)quoted=true;
      else throw Error("CSV contains an unexpected quote.");
    }else if(ch===","&&!quoted){row.push(field);field="";}
    else if((ch==="\r"||ch==="\n")&&!quoted){if(ch==="\r"&&value[i+1]==="\n")i++;commit();}
    else field+=ch;
  }
  if(quoted)throw Error("CSV has an unclosed quoted field.");
  commit();
  if(lines.length<2||lines.length>2501)throw Error("CSV must contain 1–2500 plot rows.");
  const headers=lines[0].map(normalizeHeader);
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)
    throw Error("CSV headings are missing or duplicated.");
  const match={};
  for(const [key,options] of Object.entries(alias)){
    const choices=headers.flatMap((header,i)=>options.includes(header)?[i]:[]);
    if(choices.length>1)throw Error("Conflicting CSV columns for "+key+".");
    if(choices.length)match[key]=choices[0];
  }
  if(match.plotId===undefined)throw Error("CSV needs a Plot ID / Plot No column.");
  return lines.slice(1).map((line,index)=>{
    if(line.length>headers.length)throw Error("CSV row "+(index+2)+" has extra columns.");
    const result={};
    for(const [key,i] of Object.entries(match))result[key]=(line[i]||"").trim();
    return result;
  });
}
export function normalizeGeoInventoryRows(rawRows){
  if(!Array.isArray(rawRows)||rawRows.length<1||rawRows.length>2500)
    throw Error("Inventory requires 1–2500 plot rows.");
  const seen=new Set();
  return rawRows.map((raw,index)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid inventory row "+(index+1));
    const plotId=trim(raw.plotId??raw.id,48);
    if(!validId(plotId))throw Error("Plot ID missing or invalid on row "+(index+1)+".");
    const key=plotId.toLowerCase();
    if(seen.has(key))throw Error("Duplicate Plot ID: "+plotId);
    seen.add(key);
    const supplied=["sqft","sqm","sqyd"].filter(key=>raw[key]!==undefined&&String(raw[key]??"").trim()!=="");
    if(supplied.length && raw.area!==undefined && String(raw.area).trim()!=="")
      throw Error("Plot "+plotId+": choose area+unit OR sqft/sqm/sqyd, not both.");
    let area=positive(raw.area,"Plot "+plotId+" area"),areaUnit=trim(raw.areaUnit,8).toLowerCase();
    if(supplied.length){
      const numbers=Object.fromEntries(supplied.map(key=>[key,positive(raw[key],"Plot "+plotId+" "+key)]));
      const sqm=numbers.sqm??(numbers.sqft!=null?numbers.sqft*0.09290304:numbers.sqyd*0.83612736);
      for(const type of supplied){
        const value=type==="sqm"?sqm:type==="sqft"?sqm/0.09290304:sqm/0.83612736;
        if(Math.abs(numbers[type]-value)/value>0.01)
          throw Error("Plot "+plotId+": contradictory sqft/sqm/sqyd values.");
      }
      const preferred=supplied.includes("sqm")?"sqm":supplied.includes("sqft")?"sqft":"sqyd";
      areaUnit=preferred;area=numbers[preferred];
    }
    if(area && !["sqm","sqft","sqyd"].includes(areaUnit))
      throw Error("Plot "+plotId+": areaUnit (sqm/sqft/sqyd) is required.");
    if(!area && areaUnit && !["sqm","sqft","sqyd"].includes(areaUnit))
      throw Error("Plot "+plotId+": invalid areaUnit.");
    const areaSource=trim(raw.areaSource||raw.measurementSource,160);
    if(area&&!areaSource)throw Error("Plot "+plotId+": approved area source/reference required.");
    const measurements={};
    let anySide=false;
    for(const name of ["front","back","depthA","depthB"]){
      const value=positive(raw[name],"Plot "+plotId+" "+name);
      measurements[name]=value;if(value)anySide=true;
    }
    const lengthUnit=trim(raw.lengthUnit,6).toLowerCase();
    const measurementSource=trim(raw.measurementSource,160);
    if(anySide&&(!["m","ft"].includes(lengthUnit)||!measurementSource))
      throw Error("Plot "+plotId+": explicit ft/m unit and source required for side measurements.");
    if(lengthUnit&&!["m","ft"].includes(lengthUnit))throw Error("Plot "+plotId+": invalid lengthUnit.");
    const facing=trim(raw.facing,24).toLowerCase();
    if(facing&&!["north","north-east","east","south-east","south","south-west","west","north-west"].includes(facing))
      throw Error("Plot "+plotId+": invalid compass facing.");
    return {id:plotId,area,areaUnit:areaUnit||"",areaSource,
      ...measurements,lengthUnit,measurementSource,
      road:trim(raw.road,160),facing,facingSource:trim(raw.facingSource,160),
      dimensions:trim(raw.dimensions,140),notes:trim(raw.notes,500)};
  });
}
export function geoInventoryDiff(previous,upcoming,mappedIds=[]){
  const old=new Map(previous.map(p=>[p.id.toLowerCase(),p]));
  const newer=new Map(upcoming.map(p=>[p.id.toLowerCase(),p]));
  const mapped=new Set(mappedIds.map(id=>id.toLowerCase()));
  const added=upcoming.filter(p=>!old.has(p.id.toLowerCase())).map(p=>p.id);
  const changed=upcoming.filter(p=>old.has(p.id.toLowerCase())&&
    JSON.stringify(old.get(p.id.toLowerCase()))!==JSON.stringify(p)).map(p=>p.id);
  const missing=previous.filter(p=>!newer.has(p.id.toLowerCase())).map(p=>p.id);
  const mappedChanged=changed.filter(id=>mapped.has(id.toLowerCase()));
  const mappedMissing=missing.filter(id=>mapped.has(id.toLowerCase()));
  return {added,changed,missing,mappedChanged,mappedMissing,
    mapped:upcoming.filter(p=>mapped.has(p.id.toLowerCase())).length,
    unmapped:upcoming.filter(p=>!mapped.has(p.id.toLowerCase())).length,
    unchanged:upcoming.length-added.length-changed.length};
}
export function nextUnmappedInventory(rows,mappedIds=[],afterId=""){
  const taken=new Set(mappedIds.map(id=>id.toLowerCase()));
  const list=[...rows].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
  const start=list.findIndex(p=>p.id.toLowerCase()===String(afterId).toLowerCase());
  for(let offset=1;offset<=list.length;offset++){
    const index=(start+offset+list.length)%list.length;
    if(!taken.has(list[index].id.toLowerCase()))return list[index];
  }
  return null;
}
