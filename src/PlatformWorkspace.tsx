import React, { useEffect, useState } from "react";
import { Building2, Users, ShieldCheck, LogOut, Plus, RefreshCw } from "lucide-react";

type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Firm = { id:string; name:string; status:string; employee_limit:number; employee_count:number; company_count:number };
type Company = { id:string; tenant_id:string; name:string; code:string; status:string; employee_limit:number; employee_count:number; branch_count:number };
type Overview = {tenants:Firm[];companies:Company[];totals:{tenants:number;companies:number;employees:number}};
const empty = {tenants:[],companies:[],totals:{tenants:0,companies:0,employees:0}};

export default function PlatformWorkspace({api, onLogout}: {api:Api;onLogout:()=>void}) {
  const [data,setData]=useState<Overview>(empty);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState<"firm"|"company"|"user"|null>(null);
  const [values,setValues]=useState<Record<string,string>>({});
  const [selected,setSelected]=useState("");
  const [people,setPeople]=useState<any[]>([]);
  const load=async()=>{try{setData(await api("/platform/overview"));setError("")}catch(e:any){setError(e.message)}};
  useEffect(()=>{load()},[]);
  const change=(key:string,value:string)=>setValues(v=>({...v,[key]:value}));
  const open=(kind:"firm"|"company"|"user")=>{setValues({employeeLimit:"100",role:"company_admin"});setForm(kind);setError("")};
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();setBusy(true);setError("");
    try {
      if(form==="firm") await api("/platform/tenants","POST",{firmName:values.firmName,adminName:values.adminName,adminEmail:values.adminEmail,adminPassword:values.adminPassword,employeeLimit:Number(values.employeeLimit)});
      if(form==="company") await api("/platform/companies","POST",{tenantId:values.tenantId,name:values.name,code:values.code?.toUpperCase(),employeeLimit:Number(values.employeeLimit)});
      if(form==="user") await api("/platform/users","POST",{tenantId:values.tenantId,companyId:values.role==="firm_admin"?undefined:values.companyId,name:values.name,email:values.email,password:values.password,role:values.role});
      setForm(null);await load();
    } catch(e:any){setError(e.message)} finally{setBusy(false)}
  };
  const update=async(kind:"tenants"|"companies",id:string,body:object)=>{
    setBusy(true);setError("");
    try{await api(`/platform/${kind}/${id}`,"PATCH",body);await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}
  };
  const showPeople=async(id:string)=>{try{setPeople(await api(`/platform/companies/${id}/employees`));setSelected(id);setError("")}catch(e:any){setError(e.message)}};
  return <div className="platform-shell">
    <header className="platform-header"><div className="platform-logo">peoplework<span>.</span><small>by AS Communications</small></div><div className="platform-header-actions"><span><ShieldCheck size={16}/> Platform owner</span><button className="button secondary" onClick={load}><RefreshCw size={16}/> Refresh</button><button className="button secondary" onClick={onLogout}><LogOut size={16}/> Sign out</button></div></header>
    <main className="platform-main"><div className="platform-hero"><span className="eyebrow">AS COMMUNICATIONS · CONTROL PLANE</span><h1>Every organization, in view<span className="heading-dot">.</span></h1><p>Provision firms, set employee capacity, and manage access across the Peoplework demo.</p><div className="platform-actions"><button className="button primary" onClick={()=>open("firm")}><Plus size={16}/> New firm</button><button className="button secondary" onClick={()=>open("company")}><Plus size={16}/> New company</button><button className="button secondary" onClick={()=>open("user")}><Plus size={16}/> New administrator</button></div></div>
    {error&&<div className="error" role="alert">{error}</div>}
    <div className="platform-stats"><div><Building2/><span>Firms</span><strong>{data.totals.tenants}</strong></div><div><Building2/><span>Companies</span><strong>{data.totals.companies}</strong></div><div><Users/><span>Employees</span><strong>{data.totals.employees}</strong></div></div>
    <section className="platform-card"><div className="card-heading"><div><h2>Firms</h2><p>Manage subscriptions and top-level access</p></div></div><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Organization</th><th>Companies</th><th>Employees</th><th>Limit</th><th>Status</th><th>Controls</th></tr></thead><tbody>{data.tenants.map(t=><tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.company_count}</td><td>{t.employee_count}</td><td>{t.employee_limit}</td><td><span className={t.status==="active"?"platform-active":"platform-suspended"}>{t.status}</span></td><td><button disabled={busy} onClick={()=>{const n=prompt("New firm employee limit",String(t.employee_limit));if(n&&/^\d+$/.test(n))update("tenants",t.id,{employeeLimit:Number(n)})}}>Set limit</button><button disabled={busy} onClick={()=>{if(confirm(`${t.status==="active"?"Suspend":"Reactivate"} ${t.name}?`))update("tenants",t.id,{status:t.status==="active"?"suspended":"active"})}}>{t.status==="active"?"Suspend":"Reactivate"}</button></td></tr>)}</tbody></table></div></section>
    <section className="platform-card"><div className="card-heading"><div><h2>Companies</h2><p>Company-specific capacity and access</p></div></div><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Company</th><th>Firm</th><th>Branches</th><th>Employees</th><th>Limit</th><th>Status</th><th>Controls</th></tr></thead><tbody>{data.companies.map(c=><tr key={c.id}><td><strong>{c.name}</strong><small>{c.code}</small></td><td>{data.tenants.find(t=>t.id===c.tenant_id)?.name}</td><td>{c.branch_count}</td><td>{c.employee_count}</td><td>{c.employee_limit}</td><td><span className={c.status==="active"?"platform-active":"platform-suspended"}>{c.status}</span></td><td><button onClick={()=>showPeople(c.id)}>View</button><button disabled={busy} onClick={()=>{const n=prompt("New company employee limit",String(c.employee_limit));if(n&&/^\d+$/.test(n))update("companies",c.id,{employeeLimit:Number(n)})}}>Set limit</button><button disabled={busy} onClick={()=>{if(confirm(`${c.status==="active"?"Suspend":"Reactivate"} ${c.name}?`))update("companies",c.id,{status:c.status==="active"?"suspended":"active"})}}>{c.status==="active"?"Suspend":"Reactivate"}</button></td></tr>)}</tbody></table></div></section>
    {selected&&<section className="platform-card"><div className="card-heading"><div><h2>Employees · {data.companies.find(c=>c.id===selected)?.name}</h2><p>First 1,000 records for this company</p></div><button onClick={()=>setSelected("")}>Close</button></div><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Role</th><th>Type</th></tr></thead><tbody>{people.map(p=><tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.department}</td><td>{p.designation}</td><td>{p.employment_type}</td></tr>)}</tbody></table></div></section>}
    </main>
    {form&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><div className="modal-top"><span className="eyebrow">AS COMMUNICATIONS</span><button className="icon-button" onClick={()=>setForm(null)}>×</button></div><h2>{form==="firm"?"Provision a firm":form==="company"?"Add a company":"Create an administrator"}</h2><form onSubmit={submit}><div className="form-grid">
      {form==="firm"&&<><label>Firm name<input required value={values.firmName||""} onChange={e=>change("firmName",e.target.value)}/></label><label>Firm admin name<input required value={values.adminName||""} onChange={e=>change("adminName",e.target.value)}/></label><label>Admin email<input type="email" required value={values.adminEmail||""} onChange={e=>change("adminEmail",e.target.value)}/></label><label>Temporary password<input type="password" minLength={14} required value={values.adminPassword||""} onChange={e=>change("adminPassword",e.target.value)}/></label></>}
      {form!=="firm"&&<label>Firm<select required value={values.tenantId||""} onChange={e=>{change("tenantId",e.target.value);change("companyId","")}}><option value="">Choose firm</option>{data.tenants.filter(t=>t.status==="active").map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      {form==="company"&&<><label>Company name<input required value={values.name||""} onChange={e=>change("name",e.target.value)}/></label><label>Code<input required pattern="[A-Za-z0-9_-]{2,12}" value={values.code||""} onChange={e=>change("code",e.target.value)}/></label></>}
      {form==="user"&&<><label>Role<select value={values.role||"company_admin"} onChange={e=>change("role",e.target.value)}><option value="firm_admin">Firm admin</option><option value="company_admin">Company admin</option><option value="hr">HR admin</option></select></label>{values.role!=="firm_admin"&&<label>Company<select required value={values.companyId||""} onChange={e=>change("companyId",e.target.value)}><option value="">Choose company</option>{data.companies.filter(c=>c.tenant_id===values.tenantId&&c.status==="active").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<label>Name<input required value={values.name||""} onChange={e=>change("name",e.target.value)}/></label><label>Email<input type="email" required value={values.email||""} onChange={e=>change("email",e.target.value)}/></label><label>Temporary password<input type="password" minLength={14} required value={values.password||""} onChange={e=>change("password",e.target.value)}/></label></>}
      {form!=="user"&&<label>Employee limit<input type="number" min="1" max="100000" required value={values.employeeLimit||""} onChange={e=>change("employeeLimit",e.target.value)}/></label>}
    </div>{error&&<div className="error">{error}</div>}<div className="modal-footer"><button className="button secondary" type="button" onClick={()=>setForm(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy?"Saving…":"Create"}</button></div></form></div></div>}
  </div>;
}
