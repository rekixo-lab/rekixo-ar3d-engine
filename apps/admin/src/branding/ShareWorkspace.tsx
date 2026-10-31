import {useEffect,useState} from "react";
import {projects,type CloudProjectSummary} from "../studio/cloud";
import ProjectShareBuilder from "./ProjectShareBuilder";
import MasterplanShareBuilder from "../masterplan/MasterplanShareBuilder";
export default function ShareWorkspace(){
  const slug=new URLSearchParams(window.location.search).get("project")||"";
  const [project,setProject]=useState<CloudProjectSummary|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{let valid=true;setProject(null);setError("");
    if(!slug)return;
    void projects(slug, "all",50,0).then(result=>{
      if(valid)setProject(result.projects.find(p=>p.slug===slug)||null);
    }).catch(e=>{if(valid)setError(String(e));});
    return()=>{valid=false;};
  },[slug]);
  if(!slug)return <p>Select a project from Overview.</p>;
  if(error)return <p role="alert">{error}</p>;
  if(!project)return <p>Checking project share workspace…</p>;
  return project.projectKind==="masterplan_geo"?<MasterplanShareBuilder/>:<ProjectShareBuilder/>;
}
