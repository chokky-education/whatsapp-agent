// Deploy only this isolated Warroom. Secrets stay in the ignored local config.
// REST asset flow: https://developers.cloudflare.com/workers/static-assets/direct-upload/
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isWorkId } from "./src/work-protocol.js";
const root = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(root, ".deployment.local.json");
const config = JSON.parse(await fs.readFile(file, "utf8"));
const name = "whatsapp-warroom";
if (!/^[a-f0-9]{32}$/.test(config.accountId))
  throw new Error("Missing accountId");
if (!config.adminEmail) throw new Error("Missing initial administrator email");
const alertsEnabled = config.alertsEnabled === true;
if (alertsEnabled && (!config.alertTo || !config.alertFrom))
  throw new Error(
    "Enabled alerts require verified alertTo and onboarded alertFrom",
  );
const apply = process.argv.includes("--apply");
const checkExisting = process.argv.includes("--check-existing");
const existingOnly = checkExisting || process.argv.includes("--existing-only");
const grantWork = process.argv.includes("--grant-work-owner");
const purgeWork = process.argv.includes("--purge-work");
const work = config.work;
const workEnabled = work?.enabled === true;
if ((workEnabled || purgeWork) && (!isWorkId(work?.pilot) || !isWorkId(work.memberKey) ||
    !/^[a-f0-9]{64}$/.test(work.token) || work.token === config.ingestToken)) {
  throw new Error("Invalid Work pilot config");
}
if (grantWork && (!apply || !existingOnly || !workEnabled)) {
  throw new Error("Work owner grant requires an enabled pilot on the existing Worker");
}
if (purgeWork && (!apply || !existingOnly || workEnabled)) {
  throw new Error("Work purge requires a disabled pilot on the existing Worker");
}
if (!apply && !checkExisting) {
  console.log(
    JSON.stringify({
      worker: name,
      database: name,
      assets: "warroom/public",
      cron: "* * * * *",
      googleConfigured: !!config.googleClientId,
      alertsEnabled,
      workEnabled,
      action: "preview; add --apply to deploy",
    }),
  );
  process.exit(0);
}
let auth = process.env.CLOUDFLARE_API_TOKEN;
if (!auth && process.argv.includes("--wrangler-auth")) {
  // Standard CLI credential export, captured in memory and never printed or saved.
  auth = JSON.parse(
    execFileSync("wrangler", ["auth", "token", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ).token;
}
if (!auth)
  throw new Error(
    "Set CLOUDFLARE_API_TOKEN or use --wrangler-auth with an existing local login",
  );
const base = `/accounts/${config.accountId}`;
const script = `${base}/workers/scripts/${name}`;
async function request(method, url, body, token = auth) {
  const multipart = body instanceof FormData;
  const r = await fetch("https://api.cloudflare.com/client/v4" + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!multipart && body ? { "content-type": "application/json" } : {}),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const value = await r.json();
  if (!r.ok || value.success === false)
    throw new Error(
      `Cloudflare ${method} failed: HTTP ${r.status}; codes ${(value.errors || []).map((e) => e.code).join(",")}`,
    );
  return value.result;
}
async function save() {
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.chmod(file, 0o600);
}
const databases = await request("GET", base + "/d1/database?per_page=100");
let db = databases.find((d) => d.name === name);
if (existingOnly && (!db || config.databaseId !== db.uuid || !config.ingestToken)) {
  throw new Error("Existing Warroom database and unchanged ingest credential are required");
}
if (existingOnly) {
  const [current, schedule, deploymentList] = await Promise.all([
    request("GET", script + "/settings"),
    request("GET", script + "/schedules"),
    request("GET", script + "/deployments"),
  ]);
  const bindings = new Map(current.bindings.map((item) => [item.name, item]));
  const expect = (name, type, text) => {
    const binding = bindings.get(name);
    if (!binding || binding.type !== type || (text !== undefined && binding.text !== text)) {
      throw new Error(`Live binding differs from local configuration: ${name}`);
    }
  };
  expect("DB", "d1");
  if (bindings.get("DB").id !== db.uuid) throw new Error("Live Worker database differs");
  expect("WARROOM_INGEST_TOKEN", "secret_text");
  expect("ADMIN_EMAIL", "secret_text");
  expect("ALERTS_ENABLED", "plain_text", String(alertsEnabled));
  if (config.googleClientId) expect("GOOGLE_CLIENT_ID", "plain_text", config.googleClientId);
  else if (bindings.has("GOOGLE_CLIENT_ID")) throw new Error("Live Google configuration is missing locally");
  if (config.alertTo && config.alertFrom) {
    expect("EMAIL", "send_email");
    expect("ALERT_TO", "secret_text");
    expect("ALERT_FROM", "secret_text");
    if (bindings.get("EMAIL").destination_address !== config.alertTo) throw new Error("Live email destination differs");
  } else if (bindings.has("EMAIL")) throw new Error("Live email configuration is missing locally");
  const schedules = schedule.schedules ?? schedule;
  if (schedules.length !== 1 || schedules[0].cron !== "* * * * *") throw new Error("Live Warroom schedule differs");
  const active = deploymentList.deployments?.[0]?.versions ?? [];
  if (active.length !== 1 || active[0].percentage !== 100) throw new Error("Expected one active Worker version");
  config.previousVersion = active[0].version_id;
  console.log("Existing Warroom Worker, database, email binding and schedule checked");
  if (checkExisting && !apply) process.exit(0);
}
if (!db) {
  db = await request("POST", base + "/d1/database", {
    name,
    primary_location_hint: "apac",
  });
  console.log("Created isolated Warroom database");
}
if (config.databaseId && config.databaseId !== db.uuid)
  throw new Error("Database identity changed");
config.databaseId = db.uuid;
config.ingestToken ||= randomBytes(32).toString("hex");
await save();
const dbQuery = (sql, params) => request("POST", `${base}/d1/database/${db.uuid}/query`, { sql, params });
for (const migration of ["0001.sql", "0002-work.sql"]) {
  await dbQuery(await fs.readFile(path.join(root, "migrations", migration), "utf8"));
}
if (grantWork) {
  const [[owner]] = (await dbQuery(
    "SELECT count(*) AS verified FROM members WHERE email=? AND role='admin' AND sub IS NOT NULL",
    [config.adminEmail.toLowerCase()],
  )).map((result) => result.results);
  if (owner?.verified !== 1) throw new Error("The pilot owner must sign in to Warroom first");
}
console.log("Database schema ready");
const manifest = {},
  files = new Map();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
async function walk(relative = "") {
  for (const entry of await fs.readdir(path.join(root, "public", relative), {
    withFileTypes: true,
  })) {
    const rel = path.posix.join(relative, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      await walk(rel);
      continue;
    }
    const content = await fs.readFile(path.join(root, "public", rel)),
      extension = path.extname(rel);
    const hash = createHash("sha256")
      .update(content.toString("base64") + extension.slice(1))
      .digest("hex")
      .slice(0, 32);
    manifest["/" + rel] = { hash, size: content.length };
    files.set(hash, {
      content,
      mime: mime[extension] || "application/octet-stream",
    });
  }
}
await walk();
const upload = await request(
  "POST",
  `${base}/workers/scripts/${name}/assets-upload-session`,
  { manifest },
);
let completion = upload.buckets.length ? null : upload.jwt;
for (const bucket of upload.buckets) {
  const form = new FormData();
  for (const hash of bucket) {
    const f = files.get(hash);
    form.append(
      hash,
      new Blob([f.content.toString("base64")], { type: f.mime }),
      hash,
    );
  }
  const result = await request(
    "POST",
    `${base}/workers/assets/upload?base64=true`,
    form,
    upload.jwt,
  );
  if (result?.jwt) completion = result.jwt;
}
if (!completion) throw new Error("Asset upload incomplete");
const subdomain = await request("GET", base + "/workers/subdomain");
config.url = `https://${name}.${subdomain.subdomain}.workers.dev`;
const bindings = [
  { type: "d1", name: "DB", id: db.uuid },
  { type: "assets", name: "ASSETS" },
  { type: "secret_text", name: "ADMIN_EMAIL", text: config.adminEmail },
  {
    type: "secret_text",
    name: "WARROOM_INGEST_TOKEN",
    text: config.ingestToken,
  },
  { type: "plain_text", name: "ALERTS_ENABLED", text: String(alertsEnabled) },
  { type: "plain_text", name: "PUBLIC_URL", text: config.url },
  { type: "plain_text", name: "WORK_ENABLED", text: String(workEnabled) },
];
if (workEnabled) bindings.push(
  { type: "plain_text", name: "WORK_PILOT_ID", text: work.pilot },
  { type: "plain_text", name: "WORK_MEMBER_KEY", text: work.memberKey },
  { type: "secret_text", name: "WORK_BRIDGE_TOKEN", text: work.token },
);
if (config.googleClientId)
  bindings.push({
    type: "plain_text",
    name: "GOOGLE_CLIENT_ID",
    text: config.googleClientId,
  });
if (config.alertTo && config.alertFrom)
  bindings.push(
    { type: "send_email", name: "EMAIL", destination_address: config.alertTo },
    { type: "secret_text", name: "ALERT_TO", text: config.alertTo },
    { type: "secret_text", name: "ALERT_FROM", text: config.alertFrom },
  );
const form = new FormData();
form.append(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        main_module: "worker.js",
        compatibility_date: "2026-11-01",
        bindings,
        assets: { jwt: completion, config: { run_worker_first: true } },
        observability: { enabled: false },
      }),
    ],
    { type: "application/json" },
  ),
);
form.append(
  "worker.js",
  new Blob([await fs.readFile(path.join(root, "dist/worker.js"))], {
    type: "application/javascript+module",
  }),
  "worker.js",
);
const deployed = await request("PUT", `${base}/workers/scripts/${name}`, form);
if (!existingOnly) {
  await request("POST", `${script}/subdomain`, { enabled: true, previews_enabled: false });
  await request("PUT", `${script}/schedules`, [{ cron: "* * * * *" }]);
}
if (grantWork) {
  const result = await dbQuery(`
    INSERT INTO work_access(pilot,google_sub,member_key)
    SELECT ?,sub,? FROM members WHERE email=? AND role='admin' AND sub IS NOT NULL
    ON CONFLICT(pilot) DO UPDATE SET member_key=excluded.member_key
    WHERE work_access.google_sub=excluded.google_sub AND work_access.member_key=excluded.member_key
  `, [work.pilot, work.memberKey, config.adminEmail.toLowerCase()]);
  if (!result[0]?.meta?.changes) throw new Error("The Work owner grant could not be created");
}
if (purgeWork) {
  await request("POST", `${base}/d1/database/${db.uuid}/query`, { batch: [
    { sql: "DELETE FROM work_access WHERE pilot=?", params: [work.pilot] },
    { sql: "UPDATE work_live SET tasks=NULL, synced_at=NULL, expires_at=NULL, mode='purge' WHERE pilot=?", params: [work.pilot] },
    { sql: "DELETE FROM work_completions WHERE pilot=?", params: [work.pilot] },
  ] });
  console.log("Work grant, snapshot and pending completions removed");
}
config.version = deployed.version_id || deployed.id;
config.deployedAt = new Date().toISOString();
await save();
console.log(
  JSON.stringify({
    url: config.url,
    assets: Object.keys(manifest).length,
    googleConfigured: !!config.googleClientId,
    alertsEnabled,
    workEnabled,
  }),
);
