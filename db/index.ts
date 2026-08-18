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
            carrier_id TEXT NOT NULL DEFAULT '',
            preferred_query_source TEXT NOT NULL DEFAULT '',
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
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS shipment_schedule_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipment_id INTEGER NOT NULL,
            checked_at TEXT NOT NULL,
            vessel_name TEXT NOT NULL DEFAULT '',
            voyage TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            etd TEXT NOT NULL DEFAULT '',
            atd TEXT NOT NULL DEFAULT '',
            eta TEXT NOT NULL DEFAULT '',
            ata TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
          )
        `),
        d1.prepare(`
          CREATE INDEX IF NOT EXISTS idx_shipment_schedule_history_shipment_checked
          ON shipment_schedule_history(shipment_id, checked_at)
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS vessel_query_profiles (
            vessel_name TEXT NOT NULL,
            port_of_loading TEXT NOT NULL DEFAULT '',
            port_of_discharge TEXT NOT NULL DEFAULT '',
            carrier_id TEXT NOT NULL DEFAULT '',
            preferred_query_source TEXT NOT NULL DEFAULT '',
            success_count INTEGER NOT NULL DEFAULT 0,
            last_verified_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (vessel_name, port_of_loading, port_of_discharge)
          )
        `),
        d1.prepare(`
          CREATE INDEX IF NOT EXISTS idx_vessel_query_profiles_source
          ON vessel_query_profiles(preferred_query_source)
        `),
        d1.prepare("PRAGMA optimize"),
      ])
      .then(async () => {
        const columns = await d1
          .prepare("PRAGMA table_info(shipments)")
          .all<{ name: string }>();
        const columnNames = new Set(
          (columns.results ?? []).map((column) => column.name)
        );
        if (!columnNames.has("archived_at")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("baseline_etd")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN baseline_etd TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("baseline_eta")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN baseline_eta TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("carrier_id")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN carrier_id TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("preferred_query_source")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN preferred_query_source TEXT NOT NULL DEFAULT ''")
            .run();
        }
        await d1.prepare(`
          UPDATE shipments
          SET
            baseline_etd = CASE
              WHEN baseline_etd <> '' THEN baseline_etd
              WHEN etd <> '' THEN etd
              WHEN atd <> '' AND delay_days > 0
                THEN date(atd, '-' || delay_days || ' days')
              ELSE ''
            END,
            baseline_eta = CASE
              WHEN baseline_eta <> '' THEN baseline_eta
              WHEN eta <> '' AND delay_days > 0
                THEN date(eta, '-' || delay_days || ' days')
              WHEN eta <> '' THEN eta
              WHEN ata <> '' AND delay_days > 0
                THEN date(ata, '-' || delay_days || ' days')
              ELSE ''
            END
          WHERE baseline_etd = '' OR baseline_eta = ''
        `).run();
      })
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }

  return schemaReady;
}

let authSchemaReady: Promise<void> | null = null;

export function ensureAuthSchema() {
  if (!authSchemaReady) {
    const d1 = getD1();
    authSchemaReady = d1
      .prepare(`
        CREATE TABLE IF NOT EXISTS auth_attempts (
          key_hash TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL DEFAULT 0,
          failures INTEGER NOT NULL DEFAULT 0,
          locked_until INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      .run()
      .then(() => undefined)
      .catch((error) => {
        authSchemaReady = null;
        throw error;
      });
  }

  return authSchemaReady;
}
