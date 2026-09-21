# Employee data import for the demo

Peoplework accepts CSV batches of up to 200 employees in the People → Import employees screen. The browser previews rows; the API repeats strict validation, checks company/branch authorization, rejects duplicate codes, and inserts a batch atomically. The database trigger enforces platform employee limits. Import source is recorded in the audit log.

Required columns: `code,name,email,department,designation,employmentType,joinedOn`. Dates must be `YYYY-MM-DD`. Export only non-sensitive fields and fictional data for the public demo.

For SQL Server, MS Access and PostgreSQL, make a read-only source view named, for example, `EmployeeExport`, exposing these canonical column names. Run `scripts/export-employees.mjs` on a trusted local computer with read-only source credentials. Use `SOURCE_KIND=sqlserver`, `access`, or `postgres`, plus `SOURCE_TABLE=EmployeeExport`. SQL Server requires local `mssql` driver and `SOURCE_HOST`, `SOURCE_DATABASE`, `SOURCE_USER`, `SOURCE_PASSWORD`. Access requires local `odbc` driver, Microsoft Access ODBC driver on Windows, and a read-only `SOURCE_ODBC` string. PostgreSQL uses `SOURCE_DATABASE_URL` for a read-only account. Redirect the output to a local CSV and upload it in the UI. Do not put source database passwords in the web browser or Render environment.

This is a guarded export-and-import bridge, not a live synchronization. A production migration needs customer-specific field mapping, incremental synchronization, consent, data-cleaning rules, secure connector deployment and validation against the actual source schema.
