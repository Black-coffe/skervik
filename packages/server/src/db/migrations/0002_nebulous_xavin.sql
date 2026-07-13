ALTER TABLE "matches" ADD COLUMN "room_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_id_unique" UNIQUE("room_id");