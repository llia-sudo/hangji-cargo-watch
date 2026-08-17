ALTER TABLE `shipments` ADD `baseline_etd` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `shipments` ADD `baseline_eta` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `shipments`
SET
	`baseline_etd` = CASE
		WHEN `etd` <> '' THEN `etd`
		WHEN `atd` <> '' AND `delay_days` > 0 THEN date(`atd`, '-' || `delay_days` || ' days')
		ELSE ''
	END,
	`baseline_eta` = CASE
		WHEN `eta` <> '' AND `delay_days` > 0 THEN date(`eta`, '-' || `delay_days` || ' days')
		WHEN `eta` <> '' THEN `eta`
		WHEN `ata` <> '' AND `delay_days` > 0 THEN date(`ata`, '-' || `delay_days` || ' days')
		ELSE ''
	END;
