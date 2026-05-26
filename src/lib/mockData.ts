import { generateDailyDesigns } from "@/lib/designGenerator";
import { DEFAULT_BRAND_SETTINGS } from "@/types";

export async function getMockDailyBatch(date = new Date()) {
  return generateDailyDesigns({ brand: DEFAULT_BRAND_SETTINGS, count: 5, date });
}
