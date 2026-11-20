import { connection } from "next/server";
import { getFallbackModels, getModel, isGeminiConfigured } from "@/lib/gemini";
import { isTavilyConfigured } from "@/lib/tavily";
import { getMetrics } from "@/lib/metrics";

/** Public status + aggregated AI quality metrics (never returns keys or user data). */
export async function GET() {
  await connection(); // evaluate at request time, not at build time
  return Response.json({
    model: getModel(),
    fallbackModels: getFallbackModels(),
    gemini: isGeminiConfigured(),
    tavily: isTavilyConfigured(),
    metrics: getMetrics(),
  });
}
