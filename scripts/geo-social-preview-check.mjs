// Real HTTP crawler-style preview probe. No interaction with private owner APIs.
// Run against a published URL from outside the private Admin domain.
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const MAX_IMAGE_BYTES=8*1024*1024;
const previewUA="facebookexternalhit/1.1 (+https://www.facebook.com/externalhit_uatext.php)";
const attr=(html,name)=>{
 const tags=html.match(/<meta\b[^>]*>/gi)||[];
 for(const tag of tags){
  const p=tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
  if(p!==name)continue;
  return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1]||"";
 }
 return "";
};
const magic=(bytes,mime)=>{
 if(mime==="image/jpeg")return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==="image/webp")return String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&
   String.fromCharCode(...bytes.slice(8,12))==="WEBP";
 if(mime==="image/png")return bytes.slice(0,8).join(",")==="137,80,78,71,13,10,26,10";
 return false;
};
export async function verifyGeoSocialPreview(publicUrl,fetcher=fetch){
 const url=new URL(publicUrl);
 if(url.protocol!=="https:"||url.username||url.password||
    !/^\/3Dprojects\/[a-z0-9-]+\/(geo|masterplan)$/.test(url.pathname))
  throw Error("Published HTTPS Geo/masterplan share page URL required.");
 const page=await fetcher(url.toString(),{redirect:"follow",headers:{"User-Agent":previewUA,
   "Accept":"text/html"}});
 if(!page.ok)throw Error("Public share page unavailable to crawler: "+page.status);
 if(!String(page.headers.get("content-type")||"").includes("text/html"))
  throw Error("Crawler did not receive an HTML share page.");
 const html=await page.text();
 if(html.length>5*1024*1024)throw Error("Public HTML exceeds social crawler size limits.");
 const image=attr(html,"og:image"),title=attr(html,"og:title"),
  ogUrl=attr(html,"og:url"),description=attr(html,"og:description");
 if(!image||!title||!description||!ogUrl)
  throw Error("Share requires complete Open Graph title/description/page/image metadata.");
 const imageUrl=new URL(image,url.origin);
 if(imageUrl.protocol!=="https:"||imageUrl.username||imageUrl.password||
    imageUrl.pathname.includes("/api/cloud/"))
  throw Error("Open Graph poster must be a public, HTTPS image.");
 if(url.searchParams.has("share")&&imageUrl.searchParams.get("v")!==
    url.searchParams.get("share"))
  throw Error("Poster is not tied to the explicitly requested immutable share version.");
 const asset=await fetcher(imageUrl.toString(),{headers:{"User-Agent":previewUA,
   "Accept":"image/jpeg,image/webp,image/png"}});
 if(!asset.ok)throw Error("Social crawler cannot fetch versioned share image: "+asset.status);
 const mime=String(asset.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(!["image/jpeg","image/webp","image/png"].includes(mime))
  throw Error("Open Graph URL did not return an image MIME type.");
 const length=Number(asset.headers.get("content-length")||0);
 if(length>MAX_IMAGE_BYTES)throw Error("Share image exceeds crawler byte budget.");
 const body=new Uint8Array(await asset.arrayBuffer());
 if(body.length<64||body.length>MAX_IMAGE_BYTES||!magic(body,mime))
  throw Error("Share image has invalid header, zero bytes or excessive size.");
 return {schema:"rekixo-social-crawler-probe-v1",ok:true,
  publicUrl:url.toString(),ogUrl,title,imageUrl:imageUrl.toString(),
  imageMime:mime,imageBytes:body.length,version:imageUrl.searchParams.get("v"),
  warnings:["Browser crawler success does not guarantee WhatsApp's own remote cache refresh.",
    "Verify the card dimensions and appearance in real WhatsApp/Android/iOS after publication."]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const url=process.argv[2];if(!url)throw Error("Usage: node scripts/geo-social-preview-check.mjs https://your-public-site/3Dprojects/project/geo?share=version");
 const result=await verifyGeoSocialPreview(url);
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
