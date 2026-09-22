import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app";
import { ids } from "../server/seed";
import { parseEmployeeCsv } from "../src/EmployeeImport";

test("CSV parser handles quotes, required headers and malformed rows",()=>{
  const rows=parseEmployeeCsv('code,name,email,department,designation,employmentType,joinedOn\nE77,"Jane, Doe",jane@example.test,HR,Officer,Permanent,2026-01-02');
  assert.equal(rows[0].name,"Jane, Doe");
  assert.throws(()=>parseEmployeeCsv('code,name\nA,A'),/Missing columns/);
});

test("platform owner, tenant isolation, import and limits",async()=>{
  process.env.DEMO_PASSWORD="demo-test-password-2026";
  process.env.PLATFORM_OWNER_PASSWORD="owner-test-password-2026";
  const {app,db}=await createApp({memory:true,demo:true});
  const http=request(app.getHttpAdapter().getInstance());
  const owner=request.agent(app.getHttpAdapter().getInstance());
  const firm=request.agent(app.getHttpAdapter().getInstance());
  try{
    assert.equal((await http.get("/api/platform/overview")).status,401);
    const login=await owner.post("/api/session").send({email:"owner@ascommunications.test",password:process.env.PLATFORM_OWNER_PASSWORD});
    assert.equal(login.status,200,JSON.stringify(login.body));
    const csrf=login.body.csrf;
    const overview=await owner.get("/api/platform/overview");
    assert.equal(overview.status,200,JSON.stringify(overview.body));
    assert.ok(overview.body.totals.companies>=3);
    assert.equal((await owner.get("/api/employees")).status,403);
    assert.equal((await owner.post("/api/platform/tenants").send({})).status,403); // CSRF
    const tenant=await owner.post("/api/platform/tenants").set("X-CSRF-Token",csrf).send({firmName:"Test Firm",adminName:"Test Admin",adminEmail:"test-admin@example.test",adminPassword:"tenant-test-password-2026",employeeLimit:2});
    assert.equal(tenant.status,201,JSON.stringify(tenant.body));
    const company=await owner.post("/api/platform/companies").set("X-CSRF-Token",csrf).send({tenantId:tenant.body.id,name:"Test Company",code:"TEST",employeeLimit:1});
    assert.equal(company.status,201,JSON.stringify(company.body));
    const other=await firm.post("/api/session").send({email:"test-admin@example.test",password:"tenant-test-password-2026"});
    assert.equal(other.status,200,JSON.stringify(other.body));
    const otherCsrf=other.body.csrf;
    assert.equal((await firm.get(`/api/platform/companies/${ids.a}/employees`)).status,403);
    assert.equal((await firm.get(`/api/employees?companyId=${ids.a}`)).body.length,0);
    const firmCreatedCompany=await firm.post("/api/companies").set("X-CSRF-Token",otherCsrf).send({name:"Second Company",code:"SECOND"});
    assert.equal(firmCreatedCompany.status,201,JSON.stringify(firmCreatedCompany.body));
    const branch=await firm.post("/api/branches").set("X-CSRF-Token",otherCsrf).send({companyId:company.body.id,name:"Test Branch"});
    assert.equal(branch.status,201,JSON.stringify(branch.body));
    const row={code:"T001",name:"Test Employee",email:"test.employee@example.test",department:"HR",designation:"Officer",employmentType:"Permanent",joinedOn:"2026-01-02"};
    const imported=await firm.post("/api/employees/import").set("X-CSRF-Token",otherCsrf).send({companyId:company.body.id,branchId:branch.body.id,source:"csv",rows:[row]});
    assert.equal(imported.status,201,JSON.stringify(imported.body));
    assert.equal(imported.body.imported,1);
    const over=await firm.post("/api/employees/import").set("X-CSRF-Token",otherCsrf).send({companyId:company.body.id,branchId:branch.body.id,source:"csv",rows:[{...row,code:"T002"}]});
    assert.notEqual(over.status,201);
    const capacityFirm=await owner.post("/api/platform/tenants").set("X-CSRF-Token",csrf).send({firmName:"Capacity Firm",adminName:"Capacity Admin",adminEmail:"capacity-admin@example.test",adminPassword:"capacity-admin-password-2026",employeeLimit:50});
    assert.equal(capacityFirm.status,201,JSON.stringify(capacityFirm.body));
    const first=await owner.post("/api/platform/companies").set("X-CSRF-Token",csrf).send({tenantId:capacityFirm.body.id,name:"First Company",code:"FIRST",employeeLimit:30});
    assert.equal(first.status,201,JSON.stringify(first.body));
    const tooMany=await owner.post("/api/platform/companies").set("X-CSRF-Token",csrf).send({tenantId:capacityFirm.body.id,name:"Second Company",code:"SECOND",employeeLimit:25});
    assert.equal(tooMany.status,409);
    assert.match(tooMany.body.error,/Only 20 employee slots remain/);
    const second=await owner.post("/api/platform/companies").set("X-CSRF-Token",csrf).send({tenantId:capacityFirm.body.id,name:"Second Company",code:"SECOND",employeeLimit:20});
    assert.equal(second.status,201,JSON.stringify(second.body));
    const lowerFirm=await owner.patch(`/api/platform/tenants/${capacityFirm.body.id}`).set("X-CSRF-Token",csrf).send({employeeLimit:49});
    assert.equal(lowerFirm.status,409);
    assert.match(lowerFirm.body.error,/at least 50/);
    const raiseCompany=await owner.patch(`/api/platform/companies/${second.body.id}`).set("X-CSRF-Token",csrf).send({employeeLimit:21});
    assert.equal(raiseCompany.status,409);
    await assert.rejects(db.owner(q=>q.query("UPDATE platform_company_limits SET employee_limit=21 WHERE company_id=$1",[second.body.id])),{code:"23514"});
    const capacityOverview=await owner.get("/api/platform/overview");
    assert.equal(capacityOverview.body.companies.filter((c:any)=>c.tenant_id===capacityFirm.body.id).length,2);
    await db.init(); // repeated hosted-style migrations must preserve existing allocations
    const suspended=await owner.patch(`/api/platform/tenants/${tenant.body.id}`).set("X-CSRF-Token",csrf).send({status:"suspended"});
    assert.equal(suspended.status,200,JSON.stringify(suspended.body));
    assert.equal((await firm.get("/api/organization")).status,401);
  }finally{await app.close();await db.close()}
});
