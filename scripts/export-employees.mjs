// Run on a trusted computer with read-only credentials, never on the public web host.
// SOURCE_KIND=sqlserver|access|postgres SOURCE_TABLE=EmployeeExport ... node scripts/export-employees.mjs > employees.csv
// Create a read-only view with these canonical column names in the source DB.
const kind=process.env.SOURCE_KIND;
const table=process.env.SOURCE_TABLE;
if(!["sqlserver","access","postgres"].includes(kind)||!table||! /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(table))
  throw new Error("Set SOURCE_KIND=sqlserver|access|postgres and a simple SOURCE_TABLE view name");
const columns=["code","name","email","department","designation","employmentType","joinedOn"];
const quote=kind==="postgres"?(s)=>`"${s}"`:(s)=>`[${s}]`;
const query=`SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}`;
let rows=[];
if(kind==="sqlserver"){
  let sql;try{sql=(await import("mssql")).default}catch{throw new Error("Install the mssql driver locally: npm install --no-save mssql")}
  const pool=await sql.connect({server:process.env.SOURCE_HOST,database:process.env.SOURCE_DATABASE,user:process.env.SOURCE_USER,password:process.env.SOURCE_PASSWORD,options:{encrypt:true,trustServerCertificate:false,applicationIntent:"ReadOnly"}});
  try{rows=(await pool.request().query(query)).recordset}finally{await pool.close()}
}else if(kind==="access"){
  let odbc;try{odbc=(await import("odbc")).default}catch{throw new Error("Install the odbc driver locally: npm install --no-save odbc; configure the Microsoft Access ODBC driver on Windows")}
  if(!process.env.SOURCE_ODBC)throw new Error("Set SOURCE_ODBC to a read-only Access ODBC connection string");
  const connection=await odbc.connect(process.env.SOURCE_ODBC);
  try{rows=await connection.query(query)}finally{await connection.close()}
}else{
  const {default:pg}=await import("pg");
  if(!process.env.SOURCE_DATABASE_URL)throw new Error("Set SOURCE_DATABASE_URL for a read-only PostgreSQL account");
  const connection=new pg.Client({connectionString:process.env.SOURCE_DATABASE_URL});
  await connection.connect();
  try{await connection.query("BEGIN READ ONLY");rows=(await connection.query(query)).rows;await connection.query("COMMIT")}finally{await connection.end()}
}
if(rows.length>10000)throw new Error("Export exceeds 10,000 rows; narrow the source view");
const csv=(v)=>`"${String(v??"").replaceAll('"','""').replace(/^[=+@\-\t\r]/,"'$&")}"`;
process.stdout.write(columns.join(",")+"\n");
for(const row of rows){
  const normalized={...row,joinedOn:row.joinedOn instanceof Date?row.joinedOn.toISOString().slice(0,10):row.joinedOn};
  process.stdout.write(columns.map(c=>csv(normalized[c])).join(",")+"\n");
}
