// Read-only Geo customer diagram geometry. Polygon topology and edge labels
// come from the published mapping; never calculate guessed side dimensions.
const ROLE_NAMES=Object.freeze({front:"Front",back:"Back",depthA:"Depth A",depthB:"Depth B"});
const AREA_FACTORS=Object.freeze({sqm:1,sqft:0.09290304,sqyd:0.83612736});
export function publicGeoAreaUnits(area){
  if(!area||typeof area!=="object"||!Object.hasOwn(AREA_FACTORS,area.unit)||
    typeof area.value!=="number"||!Number.isFinite(area.value)||area.value<=0)return [];
  const sqm=area.value*AREA_FACTORS[area.unit];
  return [
    {unit:"sqft",label:"Sq. Feet",value:sqm/AREA_FACTORS.sqft},
    {unit:"sqm",label:"Sq. Meters",value:sqm},
    {unit:"sqyd",label:"Sq. Yards",value:sqm/AREA_FACTORS.sqyd},
  ];
}
export function publicGeoPlotDiagram(plot){
  const raw=plot?.corners;
  if(!Array.isArray(raw)||raw.length<3||raw.length>80||
    raw.some(p=>!Array.isArray(p)||p.length!==2||
      p.some(v=>typeof v!=="number"||!Number.isFinite(v))))return null;
  const xs=raw.map(p=>p[0]), ys=raw.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX,height=maxY-minY;
  if(!(width>0&&height>0))return null;
  // Allow room around the mapped polygon for two-line side name and feet labels.
  const scale=Math.min(170/width,100/height);
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const points=raw.map(p=>({x:160+(p[0]-cx)*scale,y:105+(p[1]-cy)*scale}));
  const area2=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y},0);
  if(Math.abs(area2)<0.01)return null;
  const pointText=points.map(p=>p.x.toFixed(2)+","+p.y.toFixed(2)).join(" ");
  const roles=["front","back","depthA",...(plot.layout==="three"||points.length===3?[]:["depthB"])];
  const sides=roles.flatMap(role=>{
    const side=plot.sides?.[role];
    if(!side||typeof side.length!=="number"||!Number.isFinite(side.length)||
      !(side.length>0)||!["m","ft"].includes(side.unit))return [];
    const edges=Array.isArray(side.edges)?
      [...new Set(side.edges.filter(n=>Number.isInteger(n)&&n>=0&&n<points.length))]:[];
    const segments=edges.map(i=>{
      const a=points[i],b=points[(i+1)%points.length];
      return{x1:a.x,y1:a.y,x2:b.x,y2:b.y,length:Math.hypot(b.x-a.x,b.y-a.y)};
    }).filter(e=>e.length>0);
    let labelX=null,labelY=null;
    if(segments.length){
      const total=segments.reduce((v,s)=>v+s.length,0),half=total/2;
      let consumed=0;
      for(const s of segments){
        if(consumed+s.length>=half){
          const t=(half-consumed)/s.length;
          const x=s.x1+(s.x2-s.x1)*t,y=s.y1+(s.y2-s.y1)*t;
          const dx=s.x2-s.x1,dy=s.y2-s.y1,len=s.length;
          let nx=-dy/len,ny=dx/len;
          if((x-160)*nx+(y-105)*ny<0){nx=-nx;ny=-ny;}
          labelX=Math.max(38,Math.min(282,x+nx*28));
          labelY=Math.max(23,Math.min(184,y+ny*28));
          break;
        }
        consumed+=s.length;
      }
    }
    return[{role,label:role==="depthA"&&points.length===3?"Depth":ROLE_NAMES[role],
      length:side.length,unit:side.unit,
      roadFacing:side.roadFacing===true,segments,labelX,labelY}];
  });
  // A four-role plot reads like a miniature property survey:
  // Back is above, Front below, Depth B to the left and Depth A to the right.
  // Raw polygon corners and the authoritative semantic edge/length assignments
  // never change. These are *caption anchors*, not a rewrite of source edges.
  // Edge-normal placement used to put Back beside a short/slanted top segment,
  // visually colliding with Depth A on narrow polygons (e.g. Plot 18).
  if(roles.length===4){
    const boxLeft=Math.min(...points.map(p=>p.x));
    const boxRight=Math.max(...points.map(p=>p.x));
    const boxTop=Math.min(...points.map(p=>p.y));
    const boxBottom=Math.max(...points.map(p=>p.y));
    const anchorX=(boxLeft+boxRight)/2;
    const anchorY=(boxTop+boxBottom)/2;
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    for(const side of sides){
      if(!side.segments.length)continue;
      switch(side.role){
        case "back":
          side.labelX=anchorX;
          side.labelY=clamp(boxTop-24,24,184);
          break;
        case "front":
          side.labelX=anchorX;
          side.labelY=clamp(boxBottom+24,24,184);
          break;
        case "depthA":
          side.labelX=clamp(boxRight+33,38,282);
          side.labelY=anchorY;
          break;
        case "depthB":
          side.labelX=clamp(boxLeft-33,38,282);
          side.labelY=anchorY;
          break;
      }
    }
  }
  return{pointText,vertexCount:points.length,sides};
}
