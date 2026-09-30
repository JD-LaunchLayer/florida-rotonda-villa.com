import { handleRequest } from "./http.js";
import { runScheduled } from "./scheduled.js";

// GET /decide shows the owner page. Only POST /decide approves or rejects.
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, new Date()));
  },
} satisfies ExportedHandler<Env>;
