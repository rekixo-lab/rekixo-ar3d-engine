import {useEffect,useState} from "react";
import "../management/project-management.css";

type Account={email:string;version:number;canChange:boolean};
const endpoint="/3Dprojects/api/cloud/account";
export default function OwnerAccountSettings(){
  const [account,setAccount]=useState<Account|null>(null);
  const [email,setEmail]=useState("");
  const [currentPassword,setCurrentPassword]=useState("");
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;
    void fetch(endpoint,{cache:"no-store"}).then(async r=>{
      const x=await r.json() as Account&{error?:string};
      if(!r.ok)throw Error(x.error||"Account unavailable.");
      if(active){setAccount(x);setEmail(x.email);}
    }).catch(e=>{if(active)setError(String(e));});
    return()=>{active=false;};
  },[]);
  async function save(){
    if(!account||busy)return;
    setBusy(true);setError("");
    try{
      if(newPassword!==confirmPassword)throw Error("New passwords do not match.");
      if(newPassword&&newPassword.length<12)throw Error("New password needs at least 12 characters.");
      if(!window.confirm("Change Super Admin login and sign out all current sessions?"))return;
      const response=await fetch(endpoint,{method:"PATCH",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({
          expectedVersion:account.version,newEmail:email.trim(),currentPassword,newPassword
        })});
      const result=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!result.ok)throw Error(result.error||"Account update failed.");
      setCurrentPassword("");setNewPassword("");setConfirmPassword("");
      window.location.replace("/3Dprojects/login");
    }catch(e){setError(e instanceof Error?e.message:"Account update failed.");}
    finally{setBusy(false);}
  }
  return <main className="engine-manage">
    <header><p className="eyebrow">ENGINE SUPER ADMIN</p><h1>Account Security</h1>
      <p>Change your own Owner sign-in. Client Admin passwords are managed separately in Clients.</p></header>
    {error&&<p className="engine-manage-error" role="alert">{error}</p>}
    <section className="engine-manage-card">
      <h2>Super Admin Login</h2>
      <p>Confirm your existing password to change email or password. All current Owner sessions will be signed out.</p>
      <form onSubmit={e=>{e.preventDefault();void save();}}>
        <div className="engine-manage-grid">
          <label>Login Email<input required type="email" autoComplete="email" maxLength={254}
            disabled={!account||busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label>Current Password<input required type="password" autoComplete="current-password"
            maxLength={128} disabled={!account||busy} value={currentPassword}
            onChange={e=>setCurrentPassword(e.target.value)}/></label>
          <label>New Password (optional)<input type="password" autoComplete="new-password"
            minLength={12} maxLength={128} disabled={!account||busy} value={newPassword}
            onChange={e=>setNewPassword(e.target.value)}/></label>
          <label>Confirm New Password<input type="password" autoComplete="new-password"
            minLength={12} maxLength={128} disabled={!account||busy} value={confirmPassword}
            onChange={e=>setConfirmPassword(e.target.value)}/></label>
        </div>
        <div className="engine-manage-actions">
          <span>Existing Engine projects, client passwords and releases will not change.</span>
          <button disabled={!account||busy||!currentPassword||(!newPassword&&email.trim().toLowerCase()===account.email)}
            type="submit">{busy?"Updating…":"Save & Sign Out All Sessions"}</button>
        </div>
      </form>
    </section>
  </main>;
}
