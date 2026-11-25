ALTER TABLE "expense_line_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tip_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_comments_expense_idx" ON "expense_comments" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_line_items_expense_idx" ON "expense_line_items" USING btree ("expense_id");