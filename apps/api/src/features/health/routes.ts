// Author: Brijesh Dave <https://github.com/brijeshdave>
// Liveness (/health) and readiness (/ready). Liveness only reports the process is
// up. Readiness pings real dependencies: the app DB and the log DB. Redis is
// added in Step 3 (kept "skipped" until then).
import type { FastifyInstance } from "fastify";

import { appPool, logPool, pingPool } from "@/core/db/pool.js";
import { pingRedis } from "@/core/redis.js";

type CheckStatus = "ok" | "down" | "skipped";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", { schema: { tags: ["Health"], summary: "Liveness probe" } }, async () => {
    return { status: "ok", uptimeSeconds: Math.round(process.uptime()) };
  });

  app.get(
    "/ready",
    { schema: { tags: ["Health"], summary: "Readiness probe (pings dependencies)" } },
    async (_req, reply) => {
      const [appDb, logDb, redisOk] = await Promise.all([
        pingPool(appPool),
        pingPool(logPool),
        pingRedis(),
      ]);
      const checks: Record<string, CheckStatus> = {
        appDb: appDb ? "ok" : "down",
        logDb: logDb ? "ok" : "down",
        redis: redisOk ? "ok" : "down",
      };
      const ready = Object.values(checks).every((s) => s === "ok" || s === "skipped");
      reply.status(ready ? 200 : 503);
      return { status: ready ? "ok" : "degraded", checks };
    },
  );
}
