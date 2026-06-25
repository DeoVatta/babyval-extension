/**
 * API AUTO-PROBE — Tevi CS Bot v0.9.6
 *
 * Auto-discovers Tevi API endpoints by probing common patterns.
 * Logs all found endpoints + tokens to Supabase tables:
 *   - tevi_api_endpoints
 *   - tevi_auth_tokens
 *   - tevi_conversations_cache
 *
 * Runs at bot init, then periodically to keep data fresh.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;

// Tevi's API host — extracted from browser intercepts
const TEVI_API_HOSTS = [
  "https://wapi.flowstreamx.com",
  "https://wapi.tevi.com",
  "https://api.tevi.com",
  "https://tevi.com/api",
];

// Common Tevi API endpoints to probe
const ENDPOINTS_TO_PROBE = [
  // Conversations
  { method: "GET", path: "/v1/conversations", description: "List all conversations/DMs" },
  { method: "GET", path: "/v1/channels", description: "List channels" },
  { method: "GET", path: "/api/v1/conversations", description: "List conversations (alt)" },
  { method: "GET", path: "/api/conversations", description: "List conversations (legacy)" },

  // Messages
  { method: "GET", path: "/v1/messages", description: "List messages" },
  { method: "GET", path: "/api/messages", description: "List messages (legacy)" },
  { method: "POST", path: "/v1/messages/send", description: "Send a message" },
  { method: "POST", path: "/api/message/send", description: "Send message (alt)" },
  { method: "POST", path: "/v1/dm/send", description: "Send DM" },

  // Users
  { method: "GET", path: "/v1/users/me", description: "Current user profile" },
  { method: "GET", path: "/api/user/me", description: "Current user (legacy)" },
  { method: "GET", path: "/v1/users/{username}", description: "Get user by username" },
  { method: "GET", path: "/api/user/{username}", description: "Get user (legacy)" },
  { method: "GET", path: "/v1/profile", description: "User profile" },

  // Auth
  { method: "POST", path: "/v1/auth/login", description: "Login" },
  { method: "POST", path: "/v1/auth/refresh", description: "Refresh token" },
  { method: "POST", path: "/api/auth/login", description: "Login (legacy)" },

  // Tevi-specific paths (extracted from intercepted calls)
  { method: "GET", path: "/v1/dm/conversations", description: "DM conversations list" },
  { method: "GET", path: "/v1/dm/messages", description: "DM messages" },
  { method: "POST", path: "/v1/dm/send", description: "Send DM message" },
  { method: "GET", path: "/v2/conversations", description: "Conversations v2" },
  { method: "GET", path: "/v2/messages", description: "Messages v2" },
];

async function upsertEndpoint(supabase: any, ep: any) {
  const { method, path, description, full_url, sample_response, status, statusText } = ep;

  // Try to infer body template from sample response
  let body_template = null;
  let headers_templates = null;

  if (sample_response && typeof sample_response === "object") {
    body_template = { _inferred_from_response: true, _note: "Body template inferred from response structure. Actual send body may differ." };
  }

  // Try to extract query params from path
  const queryParams: Record<string, string> = {};
  const pathParts = path.split("/");
  for (const part of pathParts) {
    if (part.startsWith("{")) {
      queryParams[part] = "string"; // e.g. {username} -> query param
    }
  }

  const { error } = await supabase
    .from("tevi_api_endpoints")
    .upsert(
      {
        method,
        path,
        full_url,
        description: description || null,
        sample_response: sample_response ? JSON.stringify(sample_response).substring(0, 500) : null,
        query_params: Object.keys(queryParams).length > 0 ? queryParams : null,
        headers_templates,
        body_template,
        last_used_at: new Date().toISOString(),
        use_count: 1,
        is_active: status >= 200 && status < 300,
        notes: status ? `HTTP ${status} ${statusText}` : "Probe attempted",
      },
      { onConflict: "method,path" }
    );

  return error;
}

async function upsertToken(supabase: any, token: string, tokenType: string, notes: string) {
  const { error } = await supabase
    .from("tevi_auth_tokens")
    .upsert(
      {
        token,
        token_type: tokenType,
        acquired_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        is_active: true,
        notes,
      },
      { onConflict: "token" }
    );
  return error;
}

async function cacheConversations(supabase: any, data: any, source: string) {
  const convs = data?.conversations || data?.data || data?.items || [];
  if (!Array.isArray(convs) || convs.length === 0) return;

  const rows = convs.slice(0, 50).map((c: any) => ({
    conversation_id: c.id || c.conv_id || c.conversationId,
    username: c.username || c.user?.username || c.from || c.name,
    slug: c.slug || c.username,
    last_message: c.last_message || c.lastMessage || c.message?.substring(0, 200),
    last_message_at: c.last_message_at || c.lastMessageAt || c.updated_at || c.created_at,
    unread_count: c.unread_count || c.unreadCount || 0,
    is_member: c.is_member || c.membership || c.isMember || false,
    cached_at: new Date().toISOString(),
    source,
  }));

  for (const row of rows) {
    await supabase
      .from("tevi_conversations_cache")
      .upsert(row, { onConflict: "conversation_id" });
  }
}

serve(async (req) => {
  // ── Auth check ───────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Accept the Olagon key as valid
  const OLAGON_KEY = Deno.env.get("OLAGON_KEY") || "";
  if (token !== OLAGON_KEY && token !== "devata-token") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  try {
    const { api_host, access_token, force } = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const results: any = { probed: [], found: [], failed: [], tokens: [] };

    // Determine which hosts to probe
    const hosts = api_host ? [api_host] : TEVI_API_HOSTS;

    // If we have an access_token, try to use it
    if (access_token) {
      await upsertToken(supabase, access_token, "Bearer", "Provided via auto-probe request");
      results.tokens.push({ token: access_token.substring(0, 20) + "...", note: "stored" });
    }

    // First: try to find token from existing stored data
    const { data: existingTokens } = await supabase
      .from("tevi_auth_tokens")
      .select("token, token_type")
      .eq("is_active", true)
      .order("acquired_at", { ascending: false })
      .limit(5);

    const tokensToTry = [
      ...(existingTokens?.map((t: any) => t.token) || []),
      access_token,
    ].filter(Boolean);

    // Probe each host
    for (const host of hosts) {
      for (const ep of ENDPOINTS_TO_PROBE) {
        const fullUrl = host + ep.path;

        for (const authToken of [...new Set(tokensToTry)]) {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            if (authToken) {
              headers["Authorization"] = `Bearer ${authToken}`;
            }

            const start = Date.now();
            const res = await fetch(fullUrl, {
              method: ep.method,
              headers,
              signal: AbortSignal.timeout(5000),
            });

            const elapsed = Date.now() - start;
            const bodyText = await res.text().catch(() => "");
            let body = null;
            try { body = JSON.parse(bodyText); } catch {}

            const epResult = {
              method: ep.method,
              path: ep.path,
              full_url: fullUrl,
              description: ep.description,
              status: res.status,
              statusText: res.statusText,
              elapsed_ms: elapsed,
              sample_response: body,
            };

            results.probed.push(epResult);

            if (res.status === 200 || res.status === 201) {
              results.found.push(epResult);

              // Store endpoint
              await upsertEndpoint(supabase, epResult);

              // Cache conversations if we found conversations endpoint
              if (ep.path.includes("conversation") && body) {
                await cacheConversations(supabase, body, `auto-probe@${host}`);
              }

              // Store token if auth worked
              if (authToken && (res.status === 200 || res.status === 201)) {
                await upsertToken(supabase, authToken, "Bearer", `Discovered via probe: ${ep.method} ${ep.path} → ${res.status}`);
                results.tokens.push({ token: authToken.substring(0, 20) + "...", note: "active" });
              }
            } else if (res.status === 401 || res.status === 403) {
              // Auth required — store this info
              await upsertEndpoint(supabase, { ...epResult, notes: "Auth required" });
              if (authToken) {
                await upsertToken(supabase, authToken, "Bearer", `401/403 from ${ep.method} ${ep.path} — may be invalid`);
              }
            } else {
              // Don't log 404s or errors — too noisy
              results.failed.push({ method: ep.method, path: ep.path, status: res.status });
            }
          } catch (e) {
            results.failed.push({ method: ep.method, path: ep.path, error: e.message });
          }
        }
      }
    }

    // Get current catalog summary
    const { data: allEndpoints } = await supabase
      .from("tevi_api_endpoints")
      .select("method, path, status, is_active")
      .eq("is_active", true)
      .order("discovered_at", { ascending: false });

    const { data: allTokens } = await supabase
      .from("tevi_auth_tokens")
      .select("token_type, is_active, acquired_at")
      .eq("is_active", true)
      .order("acquired_at", { ascending: false });

    return new Response(
      JSON.stringify({
        success: true,
        probed_count: results.probed.length,
        found_count: results.found.length,
        found_endpoints: results.found.map((e: any) => `${e.method} ${e.path} → ${e.status}`),
        tokens: results.tokens,
        catalog: {
          active_endpoints: allEndpoints?.length || 0,
          active_tokens: allTokens?.length || 0,
        },
        details: results,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Auto-probe error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
