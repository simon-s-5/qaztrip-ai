import { z } from "zod";
import { en, type Dict, type DictKey } from "@/lib/dictionaries";
import { PLACES, placeText, type PlaceText } from "@/lib/places";
import { COSTS } from "@/lib/costs";
import { geminiJson } from "@/lib/gemini";
import { MemoryCache } from "@/lib/cache";
import { apiError, checkLimit, handleAiError, LANGUAGE_RE } from "@/lib/api";

export const maxDuration = 60;

const Body = z.object({
  language: z.string().trim().regex(LANGUAGE_RE),
  kind: z.enum(["ui", "places"]),
});

type UiResult = { strings: Dict; dir: "ltr" | "rtl"; locale: string };
type PlacesResult = { places: Record<string, PlaceText>; costs: Record<string, string> };

const uiCache = new MemoryCache<UiResult>(100);
const placesCache = new MemoryCache<PlacesResult>(100);

const SYSTEM =
  "You are a professional localization engine for a tourism website about the Almaty region of Kazakhstan. " +
  "Translate naturally and concisely for tourists. Keep the brand name 'Sapar AI', the currency sign ₸, " +
  "numbers and placeholders in curly braces (like {n} or {amount}) exactly as they are. " +
  "Use well-known local names of places when they exist in the target language.";

async function translateUi(language: string): Promise<UiResult> {
  const keys = Object.keys(en) as DictKey[];
  const schema = {
    type: "object",
    properties: {
      dir: { type: "string", enum: ["ltr", "rtl"] },
      locale: { type: "string", description: "BCP-47 language tag of the target language" },
      strings: {
        type: "object",
        properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
        required: keys,
      },
    },
    required: ["dir", "locale", "strings"],
  };
  const { data: raw } = await geminiJson({
    system: SYSTEM,
    prompt: `Translate the values of this JSON user-interface dictionary from English into ${language}. Keep all keys.\n\n${JSON.stringify(en)}`,
    schema,
  });
  const parsed = z
    .object({
      dir: z.enum(["ltr", "rtl"]).catch("ltr"),
      locale: z.string().max(20).catch("en"),
      strings: z.record(z.string(), z.unknown()),
    })
    .parse(raw);
  // Fill missing / invalid values with English so the UI never breaks.
  const strings = { ...en } as Dict;
  for (const k of keys) {
    const v = parsed.strings[k];
    if (typeof v === "string" && v.trim()) strings[k] = v;
  }
  let locale = parsed.locale;
  try {
    new Intl.NumberFormat(locale);
  } catch {
    locale = "en";
  }
  return { strings, dir: parsed.dir, locale };
}

async function translatePlaces(language: string): Promise<PlacesResult> {
  const source = PLACES.map((p) => {
    const t = placeText(p);
    return {
      id: p.id,
      localName: p.nameKk,
      ...t,
      priceLabels: Object.entries(t.priceLabels).map(([id, label]) => ({ id, label })),
    };
  });
  const str = { type: "string" };
  const schema = {
    type: "object",
    properties: {
      places: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: PLACES.map((p) => p.id) },
            name: str,
            region: str,
            description: str,
            howToGet: str,
            season: str,
            durationHint: str,
            priceLabels: {
              type: "array",
              items: { type: "object", properties: { id: str, label: str }, required: ["id", "label"] },
            },
          },
          required: ["id", "name", "region", "description", "howToGet", "season", "durationHint", "priceLabels"],
        },
      },
      generalCosts: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string", enum: COSTS.map((c) => c.id) }, label: str },
          required: ["id", "label"],
        },
      },
    },
    required: ["places", "generalCosts"],
  };
  const { data: raw } = await geminiJson({
    system: SYSTEM,
    prompt:
      `Translate these place descriptions and general cost labels from English into ${language}. Keep "id" values unchanged. ` +
      `"localName" is the Kazakh name for reference only; do not output it.\n\n` +
      JSON.stringify({ places: source, generalCosts: COSTS.map((c) => ({ id: c.id, label: c.label })) }),
    schema,
  });
  const parsed = z
    .object({
      places: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          region: z.string(),
          description: z.string(),
          howToGet: z.string(),
          season: z.string(),
          durationHint: z.string(),
          priceLabels: z.array(z.object({ id: z.string(), label: z.string() })),
        }),
      ),
      generalCosts: z.array(z.object({ id: z.string(), label: z.string() })).catch([]),
    })
    .parse(raw);

  const costLabels: Record<string, string> = Object.fromEntries(COSTS.map((c) => [c.id, c.label]));
  for (const c of parsed.generalCosts) if (c.id in costLabels && c.label) costLabels[c.id] = c.label;

  const result: Record<string, PlaceText> = {};
  for (const p of PLACES) {
    const original = placeText(p);
    const tr = parsed.places.find((x) => x.id === p.id);
    if (!tr) {
      result[p.id] = original;
      continue;
    }
    const labels = { ...original.priceLabels };
    for (const pl of tr.priceLabels) if (pl.id in labels && pl.label) labels[pl.id] = pl.label;
    result[p.id] = {
      name: tr.name || original.name,
      region: tr.region || original.region,
      description: tr.description || original.description,
      howToGet: tr.howToGet || original.howToGet,
      season: tr.season || original.season,
      durationHint: tr.durationHint || original.durationHint,
      priceLabels: labels,
    };
  }
  return { places: result, costs: costLabels };
}

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "bad_request", "Invalid language");
  const { kind } = body.data;
  const language = body.data.language.replace(/\s+/g, " ");
  const key = language.toLowerCase();

  // Cached translations do not count towards the rate limit.
  const cached = kind === "ui" ? uiCache.get(key) : placesCache.get(key);
  if (cached) return Response.json({ ...cached, cached: true });

  const limited = checkLimit(req, "translate", 6, 60);
  if (limited) return limited;

  try {
    const data =
      kind === "ui"
        ? await uiCache.getOrCreate(key, () => translateUi(language))
        : await placesCache.getOrCreate(key, () => translatePlaces(language));
    return Response.json({ ...data, cached: false });
  } catch (e) {
    return handleAiError(e);
  }
}
