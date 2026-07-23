import { hostname, platform, release } from "node:os";
import { resolve } from "node:path";
import { scanAgendaFolder } from "./scanner.mjs";
import { MarketingAgentApi } from "./api-client.mjs";

const rootArg = process.argv.find((value) => value.startsWith("--folder="));
const folder = resolve(rootArg ? rootArg.slice("--folder=".length) : process.env.MZJ_AGENDA_FOLDER || ".");
const scanOnly = process.argv.includes("--scan-only");
const jobs = await scanAgendaFolder(folder);

if (scanOnly) {
  process.stdout.write(`${JSON.stringify({ folder, jobs }, null, 2)}\n`);
  process.exit(0);
}

const api = new MarketingAgentApi({
  baseUrl: process.env.MZJ_MARKETING_API_BASE,
  deviceToken: process.env.MZJ_MARKETING_DEVICE_TOKEN,
});
await api.heartbeat({ hostname: hostname(), platform: platform(), release: release(), agentVersion: "1.0.0" });
const result = await api.importPlan({ rootFolderName: folder.split(/[\\/]/).pop(), jobs });
process.stdout.write(`${JSON.stringify({ imported: jobs.length, result }, null, 2)}\n`);
