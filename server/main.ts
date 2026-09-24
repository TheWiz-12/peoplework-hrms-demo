import { createApp } from "./app";
const { app, db } = await createApp().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
const port = Number(process.env.PORT || 3001);
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
await app.listen(
  port,
  host,
);
console.log(`Peoplework API ready on port ${port}`);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
