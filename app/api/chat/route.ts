import { z } from "zod";
import type { Content } from "@google/genai";
import { geminiJson, geminiText, MissingKeyError } from "@/lib/gemini";
import { recordChat, recordChatError } from "@/lib/metrics";
import { tavilySearch, type WebResult } from "@/lib/tavily";
import { placesForPrompt } from "@/lib/places";
import { costsForPrompt } from "@/lib/costs";
import { apiError, checkLimit, handleAiError, LANGUAGE_RE } from "@/lib/api";

export const maxDuration = 60;

const Body = z.object({
  language: z.string().trim().regex(LANGUAGE_RE),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    needsSearch: { type: "boolean" },
    query: { type: "string", description: "Short web search query in English, empty if no search" },
  },
  required: ["needsSearch", "query"],
};

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid input");
  const limited = checkLimit(req, "chat", 8, 100);
  if (limited) return limited;

  const { language } = body.data;
  const messages = body.data.messages.slice(-10);
  const last = messages[messages.length - 1];
  if (last.role !== "user") return apiError(400, "bad_request", "Last message must be from user");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });

  try {
    // Step 1: does the question need fresh information from the web?
    const history = messages
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    // This step is optional: if the AI is busy here, we answer without web search instead of failing.
    let route = { needsSearch: false, query: "" };
    try {
      route = (
        await geminiJson({
          system:
            "Decide whether answering the user's last message needs fresh or external information from the web " +
            "(weather, road or pass conditions, opening hours, schedules, events, news, current prices, visa rules, " +
            "or facts about places/services not commonly known). Static general knowledge does not need search. " +
            `Today is ${today}. If search is needed, write a concise English query that mentions Almaty/Kazakhstan.`,
          prompt: history,
          schema: ROUTER_SCHEMA,
          parse: (d) => z.object({ needsSearch: z.boolean(), query: z.string() }).parse(d),
          limits: { budgetMs: 12_000, attemptTimeoutMs: 8_000, maxAttempts: 2 },
        })
      ).data;
    } catch (e) {
      if (e instanceof MissingKeyError) throw e;
      console.warn("Search router failed, answering without web search");
    }

    // Step 2: search with Tavily if needed.
    let sources: WebResult[] = [];
    if (route.needsSearch && route.query.trim()) {
      sources = (await tavilySearch(route.query.slice(0, 200))) ?? [];
    }

    // Step 3: answer.
    const webBlock = sources.length
      ? sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.content}`).join("\n\n")
      : route.needsSearch
        ? "Web search was needed but returned no results. Say that fresh information is unavailable."
        : "No web search was used.";

    const system = `You are Sapar AI, a friendly travel assistant for tourists in Almaty city and the Almaty region of Kazakhstan.
Today is ${today}. Always answer in ${language}, whatever language the user writes in.
FACTS YOU MAY USE:
- DATABASE of places (our own data; all prices are approximate and UNVERIFIED): ${JSON.stringify(placesForPrompt())}
- GENERAL COSTS in Almaty (transport, meals, accommodation; approximate and UNVERIFIED): ${JSON.stringify(costsForPrompt())}
- WEB RESULTS:\n${webBlock}
RULES:
- Prices: only quote prices that appear in DATABASE or GENERAL COSTS (say they are approximate and unverified) or in WEB RESULTS (cite them). Otherwise say the price is unknown. Never invent prices.
- When you use a web result, cite it with its number like [1].
- If you don't know something, say so and suggest checking an official source.
- Keep answers short and practical (under 200 words). Use plain text with simple line breaks and "-" for lists, no markdown headings or bold.`;

    const contents: Content[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Time budget: router ≤ 12 s + search ≤ 10 s + answer ≤ 32 s, inside the 60 s function limit.
    const { text: answer, model, fallback } = await geminiText({
      system,
      contents,
      limits: { budgetMs: 32_000, attemptTimeoutMs: 18_000 },
    });
    recordChat(route.needsSearch, sources.length, fallback);
    return Response.json({
      answer,
      model,
      searched: route.needsSearch,
      sources: sources.map((s) => ({ title: s.title, url: s.url })),
    });
  } catch (e) {
    if (!(e instanceof MissingKeyError)) recordChatError();
    return handleAiError(e);
  }
}
