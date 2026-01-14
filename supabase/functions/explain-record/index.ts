import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are ELK Solutions' compliance translator for NYC municipal property records (DOB, ECB/OATH, HPD).

Your job is to translate the provided record text into plain English, using ONLY the information in the input.

Rules:
- Do NOT invent or assume facts not explicitly present (no made-up fines, deadlines, hearing dates, statuses, or legal outcomes).
- If a detail is missing, write: "Not stated in this record."
- If the text is ambiguous, say so and provide the most likely interpretation as a "best guess," clearly labeled.
- Always preserve and reference key identifiers exactly as written (violation number, code sections, class, unit, dates).
- Keep it practical: explain what it means and what to do next.

Return JSON with exactly these keys:
{
  "summary": string,
  "meaning": string[],
  "why_it_matters": string[],
  "who_must_act": string,
  "next_steps": string[],
  "glossary": { "term": "plain explanation", ... },
  "unknowns": string[],
  "confidence": "High" | "Medium" | "Low"
}`;

interface ExplainRequest {
  agency: string;
  recordType: string;
  address: string;
  unit?: string;
  date?: string;
  rawText: string;
  otherFields?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ExplainRequest = await req.json();
    const { agency, recordType, address, unit, date, rawText, otherFields } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build user prompt from input
    const userPrompt = `Input:
Agency: ${agency}
RecordType: ${recordType}
Address: ${address}
Unit: ${unit || "N/A"}
Date: ${date || "N/A"}
RawText: ${rawText}
OtherFields: ${JSON.stringify(otherFields || {})}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to get AI explanation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Empty response from AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON from AI response (handle markdown code blocks)
    let parsed;
    try {
      // Remove markdown code block if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.slice(0, -3);
      }
      parsed = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ error: "Invalid AI response format", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("explain-record error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
