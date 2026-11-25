CREATE TABLE IF NOT EXISTS "settlement_edit_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"edited_by" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_type" text NOT NULL,
	"diff" jsonb
);
--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "settled_at" SET DATA TYPE date USING ("settled_at" AT TIME ZONE 'UTC')::date;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlement_edit_history" ADD CONSTRAINT "settlement_edit_history_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlement_edit_history" ADD CONSTRAINT "settlement_edit_history_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_edit_history_settlement_idx" ON "settlement_edit_history" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_edit_history_expense_idx" ON "expense_edit_history" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_participants_user_idx" ON "expense_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_payers_user_idx" ON "expense_payers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_from_idx" ON "settlements" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_to_idx" ON "settlements" USING btree ("to_user_id");