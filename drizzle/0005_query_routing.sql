ALTER TABLE `shipments` ADD `carrier_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `shipments` ADD `preferred_query_source` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE `vessel_query_profiles` (
  `vessel_name` text NOT NULL,
  `port_of_loading` text NOT NULL DEFAULT '',
  `port_of_discharge` text NOT NULL DEFAULT '',
  `carrier_id` text NOT NULL DEFAULT '',
  `preferred_query_source` text NOT NULL DEFAULT '',
  `success_count` integer NOT NULL DEFAULT 0,
  `last_verified_at` text NOT NULL DEFAULT '',
  PRIMARY KEY(`vessel_name`, `port_of_loading`, `port_of_discharge`)
);
--> statement-breakpoint
CREATE INDEX `idx_vessel_query_profiles_source` ON `vessel_query_profiles` (`preferred_query_source`);
