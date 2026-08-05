import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const shipments = sqliteTable(
  "shipments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNo: text("order_no").notNull(),
    customerCode: text("customer_code").notNull().default(""),
    vesselName: text("vessel_name").notNull().default(""),
    voyage: text("voyage").notNull().default(""),
    billOfLading: text("bill_of_lading").notNull().default(""),
    bookingNo: text("booking_no").notNull().default(""),
    containerNo: text("container_no").notNull().default(""),
    portOfLoading: text("port_of_loading").notNull().default(""),
    portOfDischarge: text("port_of_discharge").notNull().default(""),
    status: text("status").notNull().default("待查询"),
    etd: text("etd").notNull().default(""),
    atd: text("atd").notNull().default(""),
    eta: text("eta").notNull().default(""),
    ata: text("ata").notNull().default(""),
    delayDays: integer("delay_days").notNull().default(0),
    source: text("source").notNull().default("手工录入"),
    sourceUrl: text("source_url").notNull().default(""),
    lastCheckedAt: text("last_checked_at").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("shipments_order_no_unique").on(table.orderNo)]
);

export const authAttempts = sqliteTable("auth_attempts", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: integer("window_start").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
