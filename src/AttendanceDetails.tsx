import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3, Loader2, X } from "lucide-react";

type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Employee = { id: string; name: string; code: string };

function clock(value: string | null, timeZone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function duration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export default function AttendanceDetails({
  employee,
  api,
  onClose,
}: {
  employee: Employee;
  api: Api;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(`/attendance/employees/${employee.id}${date ? `?date=${date}` : ""}`)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        if (!date) setDate(result.date);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, employee.id, date]);

  const timeZone = detail?.employee.timezone || "Asia/Kolkata";
  const summary = detail ? [
    { label: "First IN · login", value: clock(detail.firstIn, timeZone) },
    { label: "Last OUT · logout", value: clock(detail.lastOut, timeZone) },
    { label: "Total punches", value: String(detail.totalPunches), sub: `${detail.inCount} IN · ${detail.outCount} OUT${detail.unknownCount ? ` · ${detail.unknownCount} unknown` : ""}` },
    { label: "Paired work time", value: duration(detail.workedMinutes) },
  ] : [];

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal attendance-detail" role="dialog" aria-modal="true" aria-labelledby="attendance-detail-title">
        <div className="modal-top">
          <span className="eyebrow">PEOPLEWORK · DAILY ATTENDANCE</span>
          <button ref={closeRef} className="icon-button" aria-label="Close attendance details" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="attendance-detail-heading">
          <div><h2 id="attendance-detail-title">{employee.name}</h2><span className="mono">{employee.code}</span></div>
          <label className="attendance-date"><CalendarDays size={17} /><span>Date</span><input aria-label="Attendance date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </div>
        {loading && <div className="attendance-detail-message"><Loader2 className="spin" size={18} /> Loading punches…</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {!loading && detail && !error && <>
          <p className="attendance-detail-location">{detail.employee.branchName} · Times shown in {detail.employee.timezone}</p>
          <div className="attendance-summary-grid">
            {summary.map((item) => <div className="attendance-summary-card" key={item.label}><small>{item.label}</small><strong>{item.value}</strong>{item.sub && <span>{item.sub}</span>}</div>)}
          </div>
          {detail.openSession && <div className="attendance-open-note">This day has an IN punch without a matching OUT punch.</div>}
          <div className="attendance-timeline-title"><Clock3 size={17} /><h3>Every punch</h3><span>{detail.events.length} recorded</span></div>
          {detail.events.length ? <ol className="attendance-timeline">
            {detail.events.map((event: any, index: number) => <li key={event.id}>
              <span className={`attendance-punch-mark ${event.direction}`} />
              <div><strong>{event.direction.toUpperCase()}</strong><small>Punch {index + 1} · {event.source === "device" ? "Face reader" : event.source === "manual" ? "Manual" : event.source}</small></div>
              <time dateTime={event.occurred_at}>{clock(event.occurred_at, timeZone)}</time>
            </li>)}
          </ol> : <div className="attendance-detail-message">No punches recorded for this date.</div>}
          <p className="attendance-detail-footnote">Worked time adds completed IN→OUT pairs on this date. Repeated punches remain visible; unmatched and overnight punches require HR review before payroll.</p>
        </>}
      </section>
    </div>
  );
}
