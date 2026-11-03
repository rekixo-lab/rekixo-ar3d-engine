// Self-service owner credentials: isolated to preserve the Engine cloud worker size budget.
const encoder=new TextEncoder();
const PASSWORD_PBKDF2_ITERATIONS=100000;
// Password changes live in D1; Cloudflare secrets remain bootstrap credentials only.
export async function readOwnerCredentials(env,fallback) {
  try {
    const stored=await env.DB.prepare(`SELECT email,password_salt AS passwordSalt,
      password_hash AS passwordHash,version FROM engine_admin_owner_credentials_3d
      WHERE id='owner'`).first();
    if(stored?.email && stored.passwordSalt && stored.passwordHash)
      return {...fallback,...stored,version:Number(stored.version)};
  }catch(error){
    // Never accept the bootstrap password after a transient D1 failure.
    if(!/no such table/i.test(String(error)))throw error;
  }
  return {...fallback,version:0};
}

async function newOwnerPasswordDigest(password) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const hash=new Uint8Array(await crypto.subtle.deriveBits({
    name:"PBKDF2",salt,iterations:PASSWORD_PBKDF2_ITERATIONS,hash:"SHA-256"
  },key,256));
  return {salt:btoa(String.fromCharCode(...salt)),hash:btoa(String.fromCharCode(...hash))};
}

export async function handleOwnerAccount(request,env,actor,{current,verifyPassword,sameOrigin,clearSessionCookie,json}){
  if(request.method==="GET")return json({email:current.email,version:current.version,
    canChange:true});
  if(request.method!=="PATCH")return json({error:"Method not allowed."},{status:405});
  if(!sameOrigin(request))return json({error:"Same-origin request required."},{status:403});
  const raw=await request.text();
  if(raw.length>1800)return json({error:"Account update too large."},{status:413});
  let data;try{data=JSON.parse(raw);}catch{return json({error:"Malformed request."},{status:400});}
  const nextEmail=String(data?.newEmail||"").trim().toLowerCase();
  const currentPassword=data?.currentPassword;
  const nextPassword=data?.newPassword;
  if(!Number.isInteger(data?.expectedVersion)||data.expectedVersion!==current.version)
    return json({error:"Account changed. Sign in again and reload."},{status:409});
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(nextEmail)||nextEmail.length>254||
     typeof currentPassword!=="string"||currentPassword.length>128||
     (nextPassword!=="" && (typeof nextPassword!=="string"||nextPassword.length<12||nextPassword.length>128)))
    return json({error:"Enter a valid email and a new password of at least 12 characters, or leave new password empty."},{status:400});
  if(!await verifyPassword(currentPassword,current.passwordSalt,current.passwordHash))
    return json({error:"Current Super Admin password is incorrect."},{status:401});
  if(nextEmail===current.email&&!nextPassword)
    return json({error:"Change email or password before saving."},{status:400});
  if(nextPassword && nextPassword===currentPassword)
    return json({error:"New password must be different from current password."},{status:400});
  const nextDigest=nextPassword?await newOwnerPasswordDigest(nextPassword):
    {salt:current.passwordSalt,hash:current.passwordHash};
  const now=new Date().toISOString();
  const expected=current.version;
  const write=expected===0?
    env.DB.prepare(`INSERT INTO engine_admin_owner_credentials_3d
      (id,email,password_salt,password_hash,version,updated_at)
      VALUES ('owner',?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(nextEmail,nextDigest.salt,nextDigest.hash,1,now):
    env.DB.prepare(`UPDATE engine_admin_owner_credentials_3d
      SET email=?,password_salt=?,password_hash=?,version=version+1,updated_at=?
      WHERE id='owner' AND version=?`)
      .bind(nextEmail,nextDigest.salt,nextDigest.hash,now,expected);
  const results=await env.DB.batch([
    write,
    env.DB.prepare(`UPDATE engine_admin_security SET session_version=session_version+1,
      updated_at=? WHERE id='owner'`).bind(now),
    env.DB.prepare(`INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,NULL,'owner',?,?)`)
      .bind(crypto.randomUUID(),actor.email,"auth.owner_account_updated",
        JSON.stringify({emailChanged:nextEmail!==current.email,passwordChanged:Boolean(nextPassword),
        allSessionsRevoked:true}),now)
  ]);
  if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    return json({error:"Account update conflicted. Sign in again."},{status:409});
  return json({ok:true,signInAgain:true},{headers:{"Set-Cookie":clearSessionCookie()}});
}

