import { asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Category } from "@splitty/shared";
import { categories } from "../db/schema.js";
import { authenticateVerified } from "../plugins/authenticate.js";

export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (): Promise<Category[]> => app.db.select().from(categories).orderBy(asc(categories.name)));
}
