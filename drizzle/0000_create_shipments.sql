CREATE TABLE `shipments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`customer_code` text DEFAULT '' NOT NULL,
	`vessel_name` text DEFAULT '' NOT NULL,
	`voyage` text DEFAULT '' NOT NULL,
	`bill_of_lading` text DEFAULT '' NOT NULL,
	`booking_no` text DEFAULT '' NOT NULL,
	`container_no` text DEFAULT '' NOT NULL,
	`port_of_loading` text DEFAULT '' NOT NULL,
	`port_of_discharge` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '待查询' NOT NULL,
	`etd` text DEFAULT '' NOT NULL,
	`atd` text DEFAULT '' NOT NULL,
	`eta` text DEFAULT '' NOT NULL,
	`ata` text DEFAULT '' NOT NULL,
	`delay_days` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT '手工录入' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`last_checked_at` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_order_no_unique` ON `shipments` (`order_no`);
--> statement-breakpoint
CREATE INDEX `shipments_status_idx` ON `shipments` (`status`);
--> statement-breakpoint
CREATE INDEX `shipments_eta_idx` ON `shipments` (`eta`);
