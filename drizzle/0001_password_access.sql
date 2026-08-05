CREATE TABLE `auth_attempts` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`window_start` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
