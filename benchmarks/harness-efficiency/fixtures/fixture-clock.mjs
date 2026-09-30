// Deterministic fixture clock. Offline runs must be exactly reproducible, so
// wall-clock time is never observed here: every timestamp comes from this
// manual clock, which advances by a deterministic step per real invocation.
// Counts and order are measured from the actual run; only the per-operation
// step sizes are fixture quantization (documented, not measured latency).
export function createFixtureClock() {
  let nowMs = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  return {
    now() {
      return nowMs;
    },
    // Deterministic step derived from the real invocation sequence number.
    tickModel() {
      modelCalls += 1;
      const step = 120 + ((modelCalls * 37) % 60);
      nowMs += step;
      return step;
    },
    tickCall() {
      toolCalls += 1;
      const step = 30 + ((toolCalls * 17) % 25);
      nowMs += step;
      return step;
    },
    counts() {
      return { modelCalls, toolCalls };
    }
  };
}
