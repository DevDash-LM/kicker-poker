// Shop API — catalog, inventory, equipped, purchases. All writes go through
// SECURITY DEFINER functions on Supabase (see schema.sql): the client can't
// grant itself items, set prices, or equip unowned cosmetics.
import { sb } from "./authClient.js";

async function rpc(name, args) {
  if (!sb) throw new Error("accounts disabled");
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  if (data?.error) { const e = new Error(data.error); e.code = data.error; e.balance = data.balance; throw e; }
  return data;
}

// Catalog is publicly readable so guests can browse before signing in.
export async function fetchCatalog() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("cosmetics")
    .select("id, type, name, tier, price, sort")
    .order("type").order("sort");
  if (error) throw error;
  return data || [];
}

// Set of owned item ids (empty when signed out).
export async function fetchInventory() {
  if (!sb) return new Set();
  const { data, error } = await sb.from("cosmetic_inventory").select("item_id");
  if (error) throw error;
  return new Set((data || []).map(r => r.item_id));
}

// { slot: item_id } for the signed-in user.
export async function fetchEquipped() {
  if (!sb) return {};
  const { data, error } = await sb.from("cosmetic_equipped").select("slot, item_id");
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.slot, r.item_id]));
}

// Buy an item with saved chips. Returns { balance, itemId, alreadyOwned }.
export async function purchase(itemId) {
  const d = await rpc("shop_purchase", { item: itemId });
  return { balance: d.balance, itemId: d.item_id ?? itemId, alreadyOwned: !!d.already_owned };
}

// Equip an owned (or free/default) item; pass null to clear the slot.
export async function equip(slot, itemId) {
  const d = await rpc("equip_cosmetic", { slot, item: itemId ?? null });
  return { slot: d.slot, itemId: d.item_id };
}
