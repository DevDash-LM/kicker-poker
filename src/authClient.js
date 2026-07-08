import { createClient } from "@supabase/supabase-js";

// Accounts are optional. If the Supabase env vars aren't set (e.g. a fresh local
// clone), `sb` is null and the whole account layer stays dormant — the app runs
// guest-only, exactly as it did before accounts existed. Nothing throws.
const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const accountsEnabled = Boolean(URL && ANON);

export const sb = accountsEnabled
  ? createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "kicker-auth",
      },
    })
  : null;
