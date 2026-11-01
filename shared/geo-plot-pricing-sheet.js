// Engine-only compatibility with the Platform Pricing Sheet columns.
// Prices are PRIVATE drafts. No booking, status, buyer or publication mutation.
const COLS={
  plotId:["plotid","plot","id","plotno","plotnumber"],
  fromId:["fromid","from","start","startid","fromplot","fromplotid"],
  toId:["toid","to","end","endid","toplot","toplotid"],
  type:["pricingtype","type","mode","pricetype"],
  unit:["unit","rateunit","per"],
  rate:["rate","ratepersqyd","ratepersqft","ratepersqm","unitrate"],
  fixed:["fixedprice","price","baseprice","amount"],
  currency:["currency","curr"]
};
const id=v=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,47}$/.test(v);
const normalizeKey=s=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function parseGeoPriceSheetCsv(raw){
  if(typeof raw!=="string"||!raw.trim()||raw.length>250000)
    throw Error("Pricing CSV must contain 1–250,000 characters.");
  const rows=[];let row=[],cell="",quoted=false,ended=false;
  const source=raw.replace(/^\uFEFF/,"");
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){
      if(quoted&&source[i+1]==='"'){cell+='"';i++;}
      else if(quoted){quoted=false;ended=true;}
      else if(!cell.trim()){quoted=true;}
      else throw Error("Unexpected CSV quote at character "+i);
    }else if(ch===","&&!quoted){row.push(cell.trim());cell="";ended=false;}
    else if((ch==="\n"||ch==="\r")&&!quoted){
      row.push(cell.trim());if(row.some(v=>v))rows.push(row);
      row=[];cell="";ended=false;if(ch==="\r"&&source[i+1]==="\n")i++;
    }else {
      if(ended&&!/\s/.test(ch))throw Error("Text after closing CSV quote.");
      cell+=ch;
    }
  }
  if(quoted)throw Error("Pricing CSV has an unterminated quoted field.");
  row.push(cell.trim());if(row.some(v=>v))rows.push(row);
  if(rows.length<2||rows.length>2501)throw Error("Pricing CSV requires 1–2,500 data rows.");
  const header=rows.shift().map(normalizeKey);
  if(new Set(header).size!==header.length)throw Error("Duplicate pricing CSV header.");
  const columns=Object.fromEntries(Object.entries(COLS).map(([name,names])=>
    [name,header.findIndex(h=>names.includes(h))]));
  if(columns.plotId<0&&(columns.fromId<0||columns.toId<0))
    throw Error("Pricing CSV needs plot_id or from_id and to_id.");
  if(columns.rate<0&&columns.fixed<0)
    throw Error("Pricing CSV needs rate or fixed_price.");
  return rows.map((r,i)=>{
    if(r.length!==header.length)throw Error("Pricing CSV row "+(i+2)+" has different column count.");
    const v=k=>columns[k]===-1?"":r[columns[k]];
    const plotId=v("plotId").trim(),fromId=v("fromId").trim(),toId=v("toId").trim();
    if(plotId?(!id(plotId)||fromId||toId):(!id(fromId)||!id(toId)))
      throw Error("Pricing row "+(i+2)+" requires one canonical plot or one valid range.");
    const rawType=v("type").toLowerCase().replace(/[^a-z]/g,"");
    const type=rawType?(["rate","perunit","unitrate"].includes(rawType)?"rate":
      ["fixed","fixedprice","lumpsum"].includes(rawType)?"fixed":"invalid"):
      v("fixed")&&!v("rate")?"fixed":"rate";
    if(type==="invalid")throw Error("Unsupported pricing type on row "+(i+2));
    const normUnit=v("unit").toLowerCase().replace(/[^a-z]/g,"");
    const unit=!normUnit?"sqyd":
      ["sqft","sqfeet","squarefeet","squarefoot"].includes(normUnit)?"sqft":
      ["sqm","sqmeter","sqmeters","squaremeter","squaremetre","squaremeters"].includes(normUnit)?"sqm":
      ["sqyd","sqyard","sqyards","squareyard","squareyards"].includes(normUnit)?"sqyd":"invalid";
    if(unit==="invalid")throw Error("Unsupported pricing unit on row "+(i+2));
    const currency=v("currency").trim().toUpperCase()||"INR";
    if(currency!=="INR")throw Error("Only INR prices may be uploaded to Engine.");
    const amount=type==="rate"?v("rate"):v("fixed");
    if(!/^\d{1,11}(?:\.\d{1,4})?$/.test(amount)||Number(amount)<=0)
      throw Error("Pricing row "+(i+2)+" needs a positive "+type+" amount (max 4 decimals).");
    if(type==="fixed"&&/\.\d{3,}/.test(amount))
      throw Error("Fixed price supports at most two INR decimal places.");
    return {plotId,fromId,toId,type,unit,amount:Number(amount),currency};
  });
}
const splitSuffix=value=>{
  const match=value.match(/^(.*?)(\d+)$/);
  return match?{prefix:match[1].toLowerCase(),number:Number(match[2])}:null;
};
const metrePerUnit={sqm:1,sqft:0.09290304,sqyd:0.83612736};
export function expandGeoPriceSheet(rules,mappedPlots){
  if(!Array.isArray(rules)||!rules.length||rules.length>2500)throw Error("Valid pricing rules required.");
  if(!Array.isArray(mappedPlots)||mappedPlots.length>2500||!mappedPlots.length)
    throw Error("A verified released Geo plot mapping is required.");
  const canonical=new Map(mappedPlots.map(p=>[p.id.toLowerCase(),p]));
  const byPlot=new Map(),exact=new Set();
  const signature=r=>[r.type,r.unit,r.amount].join("|");
  for(const rule of rules.filter(x=>!x.plotId)){
    const a=splitSuffix(rule.fromId),b=splitSuffix(rule.toId);
    if(!a||!b||a.prefix!==b.prefix)throw Error("Pricing range must use the same Plot ID prefix.");
    const from=Math.min(a.number,b.number),to=Math.max(a.number,b.number);
    const targets=mappedPlots.filter(p=>{
      const s=splitSuffix(p.id);return s&&s.prefix===a.prefix&&s.number>=from&&s.number<=to;
    });
    if(!targets.length)throw Error("Pricing range "+rule.fromId+"–"+rule.toId+" matches no mapped plots.");
    for(const p of targets){
      const key=p.id.toLowerCase(),prev=byPlot.get(key);
      if(prev&&signature(prev)!==signature(rule))
        throw Error("Conflicting pricing ranges for Plot "+p.id+".");
      byPlot.set(key,rule);
    }
  }
  for(const rule of rules.filter(x=>x.plotId)){
    const key=rule.plotId.toLowerCase();
    if(!canonical.has(key))throw Error("Pricing Plot "+rule.plotId+" is not in verified mapping.");
    if(exact.has(key))throw Error("Duplicate exact pricing Plot "+rule.plotId+".");
    exact.add(key);byPlot.set(key,rule);
  }
  if(!byPlot.size)throw Error("No plot prices matched the active mapping.");
  const out=[];
  for(const [key,rule] of byPlot){
    const p=canonical.get(key);
    const area=p.area;
    let price;
    if(rule.type==="fixed")price=rule.amount*100;
    else{
      if(!area||area.verified!==true||!Number.isFinite(area.value)||area.value<=0||
         !metrePerUnit[area.unit])throw Error("Plot "+p.id+" requires verified sourced area for rate pricing.");
      const areaInUnit=area.value*metrePerUnit[area.unit]/metrePerUnit[rule.unit];
      price=areaInUnit*rule.amount*100;
    }
    if(!Number.isFinite(price)||price<=0||price>1e12)
      throw Error("Price exceeds INR safety range for Plot "+p.id+".");
    out.push({plotId:p.id,pricingType:rule.type,unit:rule.unit,
      rate:rule.type==="rate"?rule.amount:null,
      fixedPrice:rule.type==="fixed"?rule.amount:null,
      pricePaise:Math.round(price),currency:"INR"});
  }
  return out.sort((a,b)=>a.plotId.localeCompare(b.plotId,undefined,{numeric:true}));
}
