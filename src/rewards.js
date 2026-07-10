// Rewards API — daily card draw + quest claims. The server picks the daily
// card and all amounts; claims are once-per-UTC-day by primary key. See
// supabase/schema.sql (claim_daily / claim_quest).
import { sb } from "./authClient.js";
import { utcDay } from "./progress.js";

const PROGRESS_KEY = "kicker-daily-progress";

export function loadDailyProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch { return null; }
}
export function saveDailyProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}

async function rpc(name, args) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  if (data?.error) { const e = new Error(data.error); e.code = data.error; throw e; }
  return data;
}

// Draw today's card. Returns { rank, suit, amount, streak, balance }.
export async function claimDaily() {
  const d = await rpc("claim_daily");
  return { rank: d.card_rank, suit: d.card_suit, amount: d.amount, streak: d.streak, balance: d.balance };
}

// Today's claim state + current streak. { claimedToday, today, streak }.
export async function fetchDailyStatus() {
  if (!sb) return null;
  const { data, error } = await sb
    .from("daily_claims")
    .select("claim_date, card_rank, card_suit, amount, streak")
    .order("claim_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = data?.[0] || null;
  const today = utcDay();
  return {
    claimedToday: last?.claim_date === today,
    today: last?.claim_date === today ? last : null,
    streak: last?.claim_date === today ? last.streak : 0,
  };
}

// Server-defined quest list (public read).
export async function fetchQuests() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("quests").select("id, name, goal, reward, sort").order("sort");
  if (error) throw error;
  return data || [];
}

// Which quests were already claimed today. Returns a Set of quest ids.
export async function fetchQuestClaims() {
  if (!sb) return new Set();
  const { data, error } = await sb
    .from("quest_claims").select("quest_id").eq("claim_date", utcDay());
  if (error) throw error;
  return new Set((data || []).map(r => r.quest_id));
}

// Claim a completed quest. Returns { amount, balance }.
export async function claimQuest(questId) {
  const d = await rpc("claim_quest", { quest: questId });
  return { amount: d.amount, balance: d.balance };
}
