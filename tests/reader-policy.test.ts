import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app";

test("reader roles bind to one company and branch; shifts and policy thresholds validate",async()=>{
  process.env.DEMO_PASSWORD="demo-test-password-2026";
  process.env.PLATFORM_OWNER_PASSWORD="owner-test-password-2026";
  const {app,db}=await createApp({memory:true,demo:true});
  const http=app.getHttpAdapter().getInstance();
  const firm=request.agent(http);
  const outsider=request.agent(http);
  try{
    const login=await firm.post("/api/session").send({email:"admin@meridian.test",password:process.env.DEMO_PASSWORD});
    assert.equal(login.status,200);
    const csrf=login.body.csrf;
    const company=await firm.post("/api/companies").set("X-CSRF-Token",csrf).send({name:"Reader Company",code:"READER",machineMode:2});
    assert.equal(company.status,201,JSON.stringify(company.body));
    const branch=await firm.post("/api/branches").set("X-CSRF-Token",csrf).send({companyId:company.body.id,name:"Night Plant"});
    assert.equal(branch.status,201,JSON.stringify(branch.body));
    const invalidRole=await firm.post("/api/devices").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,name:"Wrong role",machineId:"RDR-WRONG",punchRole:"alternate"});
    assert.equal(invalidRole.status,400);
    const entry=await firm.post("/api/devices").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,name:"Front entrance",machineId:"RDR-IN-1",punchRole:"in"});
    assert.equal(entry.status,201,JSON.stringify(entry.body));
    const exit=await firm.post("/api/devices").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,name:"Front exit",machineId:"RDR-OUT-1",punchRole:"out"});
    assert.equal(exit.status,201,JSON.stringify(exit.body));
    const listed=await firm.get("/api/devices");
    assert.equal(listed.status,200);
    assert.ok(listed.body.some((d:any)=>d.id===entry.body.id));
    assert.ok(listed.body.every((d:any)=>!Object.hasOwn(d,"secret")));
    assert.equal((await outsider.get("/api/devices")).status,401);
    const shift=await firm.post("/api/shifts").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,code:"N1",name:"Night shift",kind:"night",startTime:"22:00",endTime:"06:00",shiftHours:7.5,lunchStart:"01:00",lunchEnd:"01:30",graceMinutes:10});
    assert.equal(shift.status,201,JSON.stringify(shift.body));
    const invalidShift=await firm.post("/api/shifts").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,code:"BAD",name:"Bad shift",kind:"night",startTime:"22:00",endTime:"06:00",shiftHours:7,graceMinutes:10});
    assert.equal(invalidShift.status,400);
    const policy=await firm.post("/api/policies").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,name:"Plant workers",employmentType:"Permanent",effectiveFrom:"2026-09-01",rules:{annualLeave:18,sickLeave:6,graceMinutes:10,dailyHours:7.5,overtimeMultiplier:2,carryForward:5,payBasis:"monthly",approvalStages:1,punchRequired:true,halfDayEnabled:true,shortLeaveEnabled:true,presentMinHours:4,halfDayMaxHours:5,shortDayMaxHours:7,shiftId:shift.body.id}});
    assert.equal(policy.status,201,JSON.stringify(policy.body));
    assert.equal((await firm.post(`/api/policies/${policy.body.id}/publish`).set("X-CSRF-Token",csrf).send({})).status,200);
    const employee=await firm.post("/api/employees").set("X-CSRF-Token",csrf).send({companyId:company.body.id,branchId:branch.body.id,code:"R001",name:"Reader Tester",email:"reader-tester@example.test",department:"Plant",designation:"Technician",employmentType:"Permanent",joinedOn:"2026-09-01"});
    assert.equal(employee.status,201,JSON.stringify(employee.body));
    const send=async(device:any,eventId:string,occurredAt:string)=>{
      const body=JSON.stringify({employeeCode:"R001",eventId,occurredAt,direction:"unknown"});
      const stamp=String(Date.now()),nonce=randomUUID();
      const signature=createHmac("sha256",device.secret).update(`${stamp}.${nonce}.${body}`).digest("hex");
      return request(http).post("/api/biometric/events").set("Content-Type","application/json").set("x-device-id",device.machineId).set("x-timestamp",stamp).set("x-nonce",nonce).set("x-signature",signature).send(body);
    };
    assert.equal((await send(entry.body,"night-in","2026-09-24T22:00:00+05:30")).status,202);
    assert.equal((await send(exit.body,"night-out","2026-09-25T06:00:00+05:30")).status,202);
    const directions=await db.owner(q=>q.query("SELECT direction FROM attendance WHERE event_key IN($1,$2) ORDER BY occurred_at",[`${entry.body.id}:night-in`,`${exit.body.id}:night-out`]));
    assert.deepEqual(directions.rows.map((r:any)=>r.direction),["in","out"]);
    const detail=await firm.get(`/api/attendance/employees/${employee.body.id}?date=2026-09-24`);
    assert.equal(detail.status,200,JSON.stringify(detail.body));
    assert.equal(detail.body.workedMinutes,480);
    assert.equal(detail.body.status,"present");
  }finally{await app.close();await db.close()}
});
