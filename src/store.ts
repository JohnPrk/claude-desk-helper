import { Store } from "@tauri-apps/plugin-store";
import type { PlanConfig } from "./types";

const STORE_FILE = "config.json";
const KEY = "plan_config";

let storePromise: Promise<Store> | null = null;
function getStore() {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

export async function loadPlanConfig(): Promise<PlanConfig | null> {
  const store = await getStore();
  const v = await store.get<PlanConfig>(KEY);
  return v ?? null;
}

export async function savePlanConfig(cfg: PlanConfig): Promise<void> {
  const store = await getStore();
  await store.set(KEY, cfg);
  await store.save();
}
