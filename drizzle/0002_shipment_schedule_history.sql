CREATE TABLE `shipment_schedule_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shipment_id` integer NOT NULL,
	`checked_at` text NOT NULL,
	`vessel_name` text DEFAULT '' NOT NULL,
	`voyage` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`etd` text DEFAULT '' NOT NULL,
	`atd` text DEFAULT '' NOT NULL,
	`eta` text DEFAULT '' NOT NULL,
	`ata` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_shipment_schedule_history_shipment_checked` ON `shipment_schedule_history` (`shipment_id`,`checked_at`);
--> statement-breakpoint
PRAGMA optimize;
