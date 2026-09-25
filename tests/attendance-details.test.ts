import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app";
import { summarizeAttendanceDay, classifyAttendance } from "../server/attendance-day";
import { employeeId, ids } from "../server/seed";

test("daily attendance summary keeps every punch and pairs completed sessions", () => {
  const events = [
    { id: "4", occurred_at: "2030-02-03T12:30:00Z", direction: "out" as const, source: "device" },
    { id: "1", occurred_at: "2030-02-03T03:30:00Z", direction: "in" as const, source: "device" },
    { id: "2", occurred_at: "2030-02-03T03:31:00Z", direction: "in" as const, source: "device" },
    { id: "3", occurred_at: "2030-02-03T06:30:00Z", direction: "out" as const, source: "device" },
  ];
  const result = summarizeAttendanceDay(events);
  assert.equal(result.totalPunches, 4);
  assert.equal(result.inCount, 2);
  assert.equal(result.outCount, 2);
  assert.equal(result.firstIn, "2030-02-03T03:30:00.000Z");
  assert.equal(result.lastOut, "2030-02-03T12:30:00.000Z");
  assert.equal(result.workedMinutes, 180);
  assert.equal(result.openSession, false);
  assert.deepEqual(result.events.map((event) => event.id), ["1", "2", "3", "4"]);
});

test("single reader alternates by employee workday and sums multiple sessions", () => {
  const times=["03:30","07:00","07:30","12:00"];
  const result=summarizeAttendanceDay(times.map((time,i)=>({id:String(i),occurred_at:`2030-02-03T${time}:00Z`,direction:"unknown" as const,source:"device"})));
  assert.deepEqual(result.events.map(e=>e.direction),["in","out","in","out"]);
  assert.equal(result.workedMinutes,480);
  assert.equal(result.inCount,2);
  assert.equal(result.outCount,2);
  const rule={punchRequired:true,halfDayEnabled:true,shortLeaveEnabled:true,presentMinHours:4,halfDayMaxHours:5,shortDayMaxHours:7};
  assert.equal(classifyAttendance(180,2,rule),"absent");
  assert.equal(classifyAttendance(270,2,rule),"half-day");
  assert.equal(classifyAttendance(360,2,rule),"short-day");
  assert.equal(classifyAttendance(480,4,rule),"present");
  assert.equal(classifyAttendance(0,0,{...rule,punchRequired:false}),"present");
  assert.equal(classifyAttendance(480,4,rule,true),"leave");
});

test("firm, HR and employee see scoped daily punches; cross-company requests fail", async () => {
  process.env.DEMO_PASSWORD = "demo-test-password-2026";
  process.env.PLATFORM_OWNER_PASSWORD = "owner-test-password-2026";
  const { app, db } = await createApp({ memory: true, demo: true });
  const http = app.getHttpAdapter().getInstance();
  const firm = request.agent(http);
  const hr = request.agent(http);
  const employee = request.agent(http);
  const company = request.agent(http);
  const otherFirm = request.agent(http);
  const target = `/api/attendance/employees/${employeeId(1)}?date=2030-02-03`;
  try {
    assert.equal((await request(http).get(target)).status, 401);
    const firmLogin = await firm.post("/api/session").send({ email: "admin@meridian.test", password: process.env.DEMO_PASSWORD });
    assert.equal(firmLogin.status, 200);
    assert.equal((await employee.post("/api/session").send({ email: "employee@meridian.test", password: process.env.DEMO_PASSWORD })).status, 200);
    assert.equal((await company.post("/api/session").send({ email: "company@meridian.test", password: process.env.DEMO_PASSWORD })).status, 200);
    assert.equal((await otherFirm.post("/api/session").send({ email: "other@example.test", password: process.env.DEMO_PASSWORD })).status, 200);

    const hrUser = await firm.post("/api/users").set("X-CSRF-Token", firmLogin.body.csrf).send({ name: "Attendance HR", email: "attendance.hr@example.test", password: "attendance-hr-password-2026", employeeId: null });
    assert.equal(hrUser.status, 201, JSON.stringify(hrUser.body));
    const hrGrant = await firm.post("/api/access").set("X-CSRF-Token", firmLogin.body.csrf).send({ userId: hrUser.body.id, role: "hr", companyId: ids.a, branchId: null });
    assert.equal(hrGrant.status, 201, JSON.stringify(hrGrant.body));
    assert.equal((await hr.post("/api/session").send({ email: "attendance.hr@example.test", password: "attendance-hr-password-2026" })).status, 200);

    for (const occurredAt of [
      "2030-02-03T09:00:00+05:30",
      "2030-02-03T12:00:00+05:30",
      "2030-02-03T12:30:00+05:30",
      "2030-02-03T18:00:00+05:30",
    ]) {
      const direction = occurredAt.includes("09:00") || occurredAt.includes("12:30") ? "in" : "out";
      const punch = await firm.post("/api/attendance").set("X-CSRF-Token", firmLogin.body.csrf).send({ employeeId: employeeId(1), occurredAt, direction, note: "Daily detail test" });
      assert.equal(punch.status, 201, JSON.stringify(punch.body));
    }

    for (const actor of [firm, hr, employee, company]) {
      const response = await actor.get(target);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.employee.code, "EMP001");
      assert.equal(response.body.employee.timezone, "Asia/Kolkata");
      assert.equal(response.body.totalPunches, 4);
      assert.equal(response.body.inCount, 2);
      assert.equal(response.body.outCount, 2);
      assert.equal(response.body.workedMinutes, 510);
      assert.equal(response.body.firstIn, "2030-02-03T03:30:00.000Z");
      assert.equal(response.body.lastOut, "2030-02-03T12:30:00.000Z");
    }
    const employeeList = await employee.get("/api/attendance");
    assert.equal(employeeList.status, 200);
    assert.ok(employeeList.body.some((event: any) => event.employee_id === employeeId(1)));
    assert.ok(employeeList.body.every((event: any) => event.employee_id === employeeId(1)));
    assert.equal((await employee.get(`/api/attendance/employees/${employeeId(2)}?date=2030-02-03`)).status, 404);
    assert.equal((await company.get(`/api/attendance/employees/${employeeId(20)}?date=2030-02-03`)).status, 404);
    assert.equal((await otherFirm.get(target)).status, 404);
    assert.equal((await firm.get(`/api/attendance/employees/${employeeId(1)}?date=not-a-date`)).status, 400);
  } finally {
    await app.close();
    await db.close();
  }
});
