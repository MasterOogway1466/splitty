import type { FastifyRequest } from "fastify";
import { z } from "zod";

const uuid = z.string().uuid("Malformed id in URL");

/** A UUID path parameter; a malformed one is a 400, not a database error. */
export function uuidParam(request: FastifyRequest, name: string): string {
  return uuid.parse((request.params as Record<string, string>)[name]);
}
