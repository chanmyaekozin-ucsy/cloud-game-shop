import { existsSync, readFileSync } from "fs";
import path from "path";

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadShopEnv() {
  const parentEnv = path.join(process.cwd(), "..", ".env");
  const localEnv = path.join(process.cwd(), ".env");
  const localEnvCustom = path.join(process.cwd(), ".env.local");

  const combined = {
    ...parseEnvFile(parentEnv),
    ...parseEnvFile(localEnv),
    ...parseEnvFile(localEnvCustom),
  };

  for (const [key, value] of Object.entries(combined)) {
    process.env[key] = value;
  }
}

export function dominateConfig() {
  loadShopEnv();
  const rawUrl = process.env.DOMINATE_GATEWAY_URL || "https://pgw.flash-myanmar.com";
  let url = rawUrl.replace(/\/$/, "");
  if (!url.endsWith("/v1")) {
    url = `${url}/v1`;
  }
  return {
    url,
    baseUrl: rawUrl.replace(/\/$/, ""),
    key: process.env.DOMINATE_GATEWAY_API_KEY || "",
    webhookSecret: process.env.DOMINATE_WEBHOOK_SECRET || "",
  };
}

