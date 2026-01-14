import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNIT_DISCLAIMER = "Unit is inferred from text fields. These are building-level records; unit mention does not guarantee unit-level enforcement or responsibility.";

const SYSTEM_PROMPT = `You are an assistant that translates NYC housing/building regulatory record text into plain English. Be precise. Do not invent facts. If information is missing, say "Not stated."

CRITICAL CONTEXT: The unit mentioned in this record was INFERRED from text fields by our system. This is a BUILDING-LEVEL record, not a unit-level issuance. The unit mention does NOT imply:
- Unit-level enforcement
- Legal responsibility of that unit's occupant
- That the issue originated in that unit

You must include this disclaimer in your response and keep this context in mind when explaining implications.

Return JSON with exactly these keys:
{
  "disclaimer": "${UNIT_DISCLAIMER}",
  "plain_english_summary": "1-3 sentences explaining what the city is saying.",
  "what_it_means_for_a_resident": [
    "Bullet points: practical implications for someone in this building/unit."
  ],
  "what_to_do_next": [
    "Bullet points: typical next steps. Do not give legal advice. Suggest contacting building management, the issuing agency (HPD/DOB), or a licensed professional where appropriate."
  ],
  "key_details_extracted": {
    "issue": "e.g., mold in bathroom / leaky faucet / roaches",
    "location_in_text": "e.g., bathroom / entire apartment / tub",
    "law_or_code_cited": "e.g., § 27-2017.3 HMC / § 27-2026 ADM CODE / Not stated",
    "severity_class_if_any": "A|B|C|unknown",
    "dates": ["any dates found, or empty array"]
  },
  "confidence": "high|medium|low"
}`;

interface ExplainUnitMentionRequest {
  agency: string;
  recordId: string;
  recordDate?: string | null;
  recordStatus?: string | null;
  unitContext: string;
  rawText: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ExplainUnitMentionRequest = await req.json();
    const { agency, recordId, recordDate, recordStatus, unitContext, rawText } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build user prompt from input
    const userInput = {
      agency: agency || "unknown",
      record_id: recordId || "unknown",
      record_date: recordDate || null,
      record_status: recordStatus || "unknown",
      unit_context: `${unitContext} (inferred from text)`,
      raw_text: rawText,
    };

    const userPrompt = `USER INPUT JSON:\n${JSON.stringify(userInput, null, 2)}`;

    console.log("explain-unit-mention request:", { agency, recordId, unitContext });

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
      
      // Ensure disclaimer is always present
      if (!parsed.disclaimer) {
        parsed.disclaimer = UNIT_DISCLAIMER;
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ error: "Invalid AI response format", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("explain-unit-mention success:", { recordId, confidence: parsed.confidence });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("explain-unit-mention error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
