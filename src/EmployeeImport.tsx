import React, { useState } from "react";
import { X, UploadCloud } from "lucide-react";

type Api = (path:string,method?:string,body?:unknown)=>Promise<any>;
type Company={id:string;name:string};
type Branch={id:string;company_id:string;name:string};
const aliases:Record<string,string[]>={
  code:["code","employee code","employee id","emp code","emp id"],
  name:["name","employee name","full name"],
  email:["email","email address","work email"],
  department:["department","dept"],
  designation:["designation","job title","position"],
  employmentType:["employment type","employmenttype","employee type","type"],
  joinedOn:["joined on","joinedon","joining date","date of joining","doj"],
};
export function detectEmployeeFileFormat(bytes:Uint8Array):"csv"|"numbers"|"excel"|"archive" {
  if(bytes[0]!==0x50||bytes[1]!==0x4b)return "csv";
  // ZIP entry names remain readable even though workbook contents are compressed.
  const names=new TextDecoder("latin1").decode(bytes);
  if(names.includes("Index/Document.iwa"))return "numbers";
  if(names.includes("[Content_Types].xml")&&names.includes("xl/"))return "excel";
  return "archive";
}
export function parseEmployeeCsv(source:string) {
  const grid:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"') {if(quoted&&source[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(ch===","&&!quoted){row.push(cell.trim());cell=""}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&source[i+1]==="\n")i++;row.push(cell.trim());if(row.some(Boolean))grid.push(row);row=[];cell=""}
    else cell+=ch;
  }
  if(quoted)throw new Error("The CSV file has an unclosed quoted value");
  row.push(cell.trim());if(row.some(Boolean))grid.push(row);
  if(grid.length<2)throw new Error("A header and at least one employee are required");
  const headers=grid[0].map(x=>x.replace(/^\uFEFF/,"").toLowerCase().replace(/[_-]/g," ").replace(/\s+/g," ").trim());
  const indexes=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))]));
  const missing=Object.entries(indexes).filter(([,i])=>i<0).map(([k])=>k);
  if(missing.length)throw new Error("Missing columns: "+missing.join(", "));
  if(grid.length>201)throw new Error("Import up to 200 employees per batch");
  return grid.slice(1).map((r,n)=>{
    const o:any={};for(const [k,i] of Object.entries(indexes))o[k]=r[i]||"";
    if(Object.values(o).some(v=>!v))throw new Error(`Row ${n+2} has an empty required field`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(o.joinedOn))throw new Error(`Row ${n+2}: joining date must be YYYY-MM-DD`);
    return o;
  });
}
export default function EmployeeImport({api,companies,branches,onClose,onImported}:{api:Api;companies:Company[];branches:Branch[];onClose:()=>void;onImported:()=>void}) {
  const [company,setCompany]=useState(companies[0]?.id||"");
  const [branch,setBranch]=useState("");
  const [source,setSource]=useState("csv");
  const [rows,setRows]=useState<any[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const available=branches.filter(b=>b.company_id===company);
  return <div className="modal-backdrop"><div className="modal import-modal" role="dialog" aria-modal="true"><div className="modal-top"><span className="eyebrow">PEOPLEWORK · DATA IMPORT</span><button className="icon-button" aria-label="Close" onClick={onClose}><X/></button></div><h2>Import employees</h2><p>Review every row before saving. The server validates your company access, duplicate codes, and employee limits again.</p>
    <div className="form-grid"><label>Company<select value={company} onChange={e=>{setCompany(e.target.value);setBranch("")}}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Branch<select required value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Choose branch</option>{available.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Original source<select value={source} onChange={e=>setSource(e.target.value)}><option value="csv">CSV</option><option value="sqlserver">SQL Server export</option><option value="access">MS Access export</option><option value="other">Other database export</option></select></label><label className="full">CSV file<input type="file" accept=".csv,text/csv" onChange={async e=>{setError("");setRows([]);try{const file=e.target.files?.[0];if(!file)return;if(file.size>1024*1024)throw new Error("Maximum file size is 1 MB");const bytes=new Uint8Array(await file.arrayBuffer());const format=detectEmployeeFileFormat(bytes);if(format==="numbers")throw new Error("This is an Apple Numbers workbook, even though its name ends in .csv. Open it in Numbers and export it as CSV, then upload the exported file.");if(format==="excel")throw new Error("This is an Excel workbook, even though its name ends in .csv. Export or save it as CSV, then upload the exported file.");if(format==="archive")throw new Error("This file is an archive, not a CSV. Export the employee table as CSV and upload that file.");setRows(parseEmployeeCsv(new TextDecoder("utf-8").decode(bytes)))}catch(err:any){setError(err.message)}}}/></label></div>
    <p className="import-note">Required columns: code, name, email, department, designation, employmentType, joinedOn (YYYY-MM-DD). Renaming a Numbers or Excel workbook to .csv does not convert it; export it as CSV first. SQL Server, Access and other databases can export these columns to CSV; direct database access is not enabled on this public demo.</p>
    {rows.length>0&&<div className="import-preview"><strong>{rows.length} employees ready to import</strong><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Type</th><th>Joining</th></tr></thead><tbody>{rows.slice(0,10).map((r,i)=><tr key={i}><td>{r.code}</td><td>{r.name}</td><td>{r.email}</td><td>{r.employmentType}</td><td>{r.joinedOn}</td></tr>)}</tbody></table></div>{rows.length>10&&<small>Showing the first 10 rows</small>}</div>}
    {error&&<div className="error" role="alert">{error}</div>}<div className="modal-footer"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!rows.length||!branch||busy} onClick={async()=>{setBusy(true);setError("");try{await api("/employees/import","POST",{companyId:company,branchId:branch,source,rows});onImported();onClose()}catch(e:any){setError(e.message)}finally{setBusy(false)}}}><UploadCloud size={16}/>{busy?"Importing…":`Import ${rows.length||""} employees`}</button></div>
  </div></div>;
}
