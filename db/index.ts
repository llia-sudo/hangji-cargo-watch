import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1() {
  if (!env.DB) {
    throw new Error("订单数据库暂时不可用，请稍后重试。");
  }

  return env.DB;
}

let schemaReady: Promise<void> | null = null;

export function ensureShipmentsSchema() {
  if (!schemaReady) {
    const d1 = getD1();
    schemaReady = d1
      .batch([
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS shipments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT NOT NULL UNIQUE,
            customer_code TEXT NOT NULL DEFAULT '',
            vessel_name TEXT NOT NULL DEFAULT '',
            voyage TEXT NOT NULL DEFAULT '',
            bill_of_lading TEXT NOT NULL DEFAULT '',
            booking_no TEXT NOT NULL DEFAULT '',
            container_no TEXT NOT NULL DEFAULT '',
            port_of_loading TEXT NOT NULL DEFAULT '',
            port_of_discharge TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '待查询',
            etd TEXT NOT NULL DEFAULT '',
            atd TEXT NOT NULL DEFAULT '',
            eta TEXT NOT NULL DEFAULT '',
            ata TEXT NOT NULL DEFAULT '',
            delay_days INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '手工录入',
            source_url TEXT NOT NULL DEFAULT '',
            last_checked_at TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS shipments_status_idx ON shipments(status)"
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS shipments_eta_idx ON shipments(eta)"
        ),
      ])
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }

  return schemaReady;
}
