import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    baselineEtd: text("baseline_etd").notNull().default(""),
    etd: text("etd").notNull().default(""),
    atd: text("atd").notNull().default(""),
    baselineEta: text("baseline_eta").notNull().default(""),
    eta: text("eta").notNull().default(""),
    ata: text("ata").notNull().default(""),
    delayDays: integer("delay_days").notNull().default(0),
    carrierId: text("carrier_id").notNull().default(""),
    preferredQuerySource: text("preferred_query_source").notNull().default(""),
    source: text("source").notNull().default("手工录入"),
    sourceUrl: text("source_url").notNull().default(""),
    lastCheckedAt: text("last_checked_at").notNull().default(""),
    notes: text("notes").notNull().default(""),
    archivedAt: text("archived_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("shipments_order_no_unique").on(table.orderNo)]
);

export const vesselQueryProfiles = sqliteTable(
  "vessel_query_profiles",
  {
    vesselName: text("vessel_name").notNull(),
    portOfLoading: text("port_of_loading").notNull().default(""),
    portOfDischarge: text("port_of_discharge").notNull().default(""),
    carrierId: text("carrier_id").notNull().default(""),
    preferredQuerySource: text("preferred_query_source").notNull().default(""),
    successCount: integer("success_count").notNull().default(0),
    lastVerifiedAt: text("last_verified_at").notNull().default(""),
  },
  (table) => [
    uniqueIndex("vessel_query_profiles_route_unique").on(
      table.vesselName,
      table.portOfLoading,
      table.portOfDischarge
    ),
    index("idx_vessel_query_profiles_source").on(table.preferredQuerySource),
  ]
);

export const authAttempts = sqliteTable("auth_attempts", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: integer("window_start").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shipmentScheduleHistory = sqliteTable(
  "shipment_schedule_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    checkedAt: text("checked_at").notNull(),
    vesselName: text("vessel_name").notNull().default(""),
    voyage: text("voyage").notNull().default(""),
    status: text("status").notNull().default(""),
    etd: text("etd").notNull().default(""),
    atd: text("atd").notNull().default(""),
    eta: text("eta").notNull().default(""),
    ata: text("ata").notNull().default(""),
    source: text("source").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_shipment_schedule_history_shipment_checked").on(
      table.shipmentId,
      table.checkedAt
    ),
  ]
);
