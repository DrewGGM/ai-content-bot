/** Registro local de las campañas de ads creadas desde el panel (data/ads.json), para listarlas
 *  y optimizarlas. Las métricas se leen en vivo de Meta; esto solo guarda las referencias. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE = join(ROOT, "data", "ads.json");

export interface AdCampaignRecord {
  campaignId: string;
  adsetId: string;
  adIds: string[];
  name: string;
  objective: string;
  status: "PAUSED" | "ACTIVE";
  dailyBudget: number;
  createdAt: string;
  createdBy: string;
  pieceIds: string[];
}

function read(): AdCampaignRecord[] {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return [];
  }
}

function write(list: AdCampaignRecord[]): void {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(list, null, 2));
}

export function listAdCampaigns(): AdCampaignRecord[] {
  return read().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addAdCampaign(rec: AdCampaignRecord): void {
  const list = read();
  list.push(rec);
  write(list);
}

export function updateAdCampaignStatus(campaignId: string, status: "PAUSED" | "ACTIVE"): void {
  const list = read();
  const rec = list.find((r) => r.campaignId === campaignId);
  if (rec) { rec.status = status; write(list); }
}
