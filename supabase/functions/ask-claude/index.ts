// Supabase Edge Function: ask-claude
// Proxy zwischen der Nonna-App (Browser) und der Anthropic API.
// Der eigentliche Anthropic-API-Key liegt NUR hier als Server-Secret
// (Deno.env.get('ANTHROPIC_API_KEY')) und wird nie an den Client geschickt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // bei Bedarf auf https://nonna.cloud einschränken
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // CORS-Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Nur POST erlaubt." } }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: "Server-Konfiguration fehlt: ANTHROPIC_API_KEY nicht gesetzt." } }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  let body: {
    prompt?: string;
    system?: string;
    maxTokens?: number;
    image?: { media_type?: string; data?: string };
    anon_id?: string;
    event_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: { message: "Ungültiger Request-Body (kein JSON)." } }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { prompt, system, maxTokens, image, anon_id, event_type } = body;
  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: { message: "Feld 'prompt' fehlt oder ist ungültig." } }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  let content: string | Array<Record<string, unknown>> = prompt;
  if (image) {
    if (
      typeof image.media_type !== "string" ||
      !ALLOWED_MEDIA_TYPES.includes(image.media_type) ||
      typeof image.data !== "string" ||
      !image.data
    ) {
      return new Response(
        JSON.stringify({ error: { message: "Feld 'image' ist ungültig (media_type/data)." } }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    // ~10 MB Rohbild-Obergrenze (Base64 ist ca. 1.37x größer als die Rohdaten)
    if (image.data.length > 14_000_000) {
      return new Response(JSON.stringify({ error: { message: "Bild ist zu groß." } }), {
        status: 413,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    content = [
      { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
      { type: "text", text: prompt },
    ];
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens ?? 1400,
        system,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await anthropicRes.json().catch(() => ({}));

    if (anthropicRes.ok && anon_id) {
      supabase
        .from("usage_events")
        .insert({ anon_id, event_type: event_type ?? "unknown" })
        .then(() => {})
        .catch((e: unknown) => console.error("Logging fehlgeschlagen:", e));
    }

    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: "Netzwerkfehler beim Aufruf der Anthropic API: " + String(err) } }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
