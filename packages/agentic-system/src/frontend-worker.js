import { isDeepStrictEqual } from "node:util";
import { FrontendContextSchema, FrontendWorkResultSchema, parseFrontendWorkOrder } from "./frontend-contracts.js";

// Frontend worker: a validated boundary around an injected Frontend executor. Recovery is
// keyed only by the Frontend WorkOrder id in a Frontend-owned session store; it never
// reads Backend sessions or stages.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
export const FrontendRecoveryAction = Object.freeze({ RETRY_EXECUTION: "RETRY_EXECUTION", COMPLETED: "COMPLETED", BLOCKED: "BLOCKED" });

export function createInMemoryFrontendSessionStore() {
  const sessions = new Map();
  return Object.freeze({
    async load(id) { return sessions.has(id) ? structuredClone(sessions.get(id)) : null; },
    async save(id, value) { sessions.set(id, structuredClone(value)); }
  });
}

export function createFrontendWorker({ executor, sessionStore = createInMemoryFrontendSessionStore() }) {
  invariant(executor && typeof executor.execute === "function", "FrontendWorker requires executor.execute()");
  invariant(sessionStore && typeof sessionStore.load === "function" && typeof sessionStore.save === "function", "FrontendWorker sessionStore requires load()/save()");
  return Object.freeze({
    async execute(rawOrder, rawContext) {
      const order = parseFrontendWorkOrder(rawOrder), context = FrontendContextSchema.parse(rawContext);
      await sessionStore.save(order.id, { state: "STARTED", order, context, result: null });
      const result = FrontendWorkResultSchema.parse(await executor.execute(order, context));
      await sessionStore.save(order.id, { state: "FINISHED", order, context, result });
      return result;
    },
    async recover(rawOrder, rawContext) {
      const order = parseFrontendWorkOrder(rawOrder), context = FrontendContextSchema.parse(rawContext);
      const session = await sessionStore.load(order.id);
      if (session == null || session.state !== "FINISHED") return Object.freeze({ action: FrontendRecoveryAction.RETRY_EXECUTION, result: null, blockers: Object.freeze([]) });
      if (!isDeepStrictEqual(session.order, order) || !isDeepStrictEqual(session.context, context)) {
        return Object.freeze({ action: FrontendRecoveryAction.BLOCKED, result: null, blockers: Object.freeze(["Frontend session does not match the prepared WorkOrder/context"]) });
      }
      return Object.freeze({ action: FrontendRecoveryAction.COMPLETED, result: FrontendWorkResultSchema.parse(session.result), blockers: Object.freeze([]) });
    }
  });
}
