import { db } from "../../db/client";
import { internalMetrics, markets } from "../../db/schema";
import { eq } from "drizzle-orm";
import { resolveMarketOnChain } from "../resolution";
import type { MarketRow } from "../../db/schema";

/**
 * Internal resolver — resolves markets based on internal app metrics stored in the DB.
 * Config shape: { metricName: string, comparison: '>=' | '<=' | '==' | '>', threshold: number }
 */
export async function resolveInternal(market: MarketRow): Promise<void> {
  const config = market.resolutionConfig as {
    metricName: string;
    comparison: string;
    threshold: number;
  } | null;

  if (!config?.metricName) {
    console.warn(`[Internal] Market #${market.onChainId}: missing resolution config`);
    return;
  }

  // Fetch the metric
  const rows = await db
    .select()
    .from(internalMetrics)
    .where(eq(internalMetrics.metricName, config.metricName))
    .limit(1);

  if (rows.length === 0) {
    console.log(`[Internal] Market #${market.onChainId}: metric "${config.metricName}" not found yet`);
    return;
  }

  const metricValue = Number(rows[0].value);
  const threshold = config.threshold;
  const isPastEnd = new Date() >= new Date(market.endTime);

  let conditionMet = false;
  switch (config.comparison) {
    case ">=":
      conditionMet = metricValue >= threshold;
      break;
    case "<=":
      conditionMet = metricValue <= threshold;
      break;
    case ">":
      conditionMet = metricValue > threshold;
      break;
    case "==":
      conditionMet = metricValue === threshold;
      break;
    default:
      console.warn(`[Internal] Market #${market.onChainId}: unknown comparison "${config.comparison}"`);
      return;
  }

  if (conditionMet) {
    console.log(`[Internal] Market #${market.onChainId}: condition met (${metricValue} ${config.comparison} ${threshold}) → YES`);
    await resolveMarketOnChain(market.onChainId, 1);
  } else if (isPastEnd) {
    console.log(`[Internal] Market #${market.onChainId}: past end time, condition not met → NO`);
    await resolveMarketOnChain(market.onChainId, 2);
  } else {
    console.log(`[Internal] Market #${market.onChainId}: condition not met yet, waiting...`);
  }
}
