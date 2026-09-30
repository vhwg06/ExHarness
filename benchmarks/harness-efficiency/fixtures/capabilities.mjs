// Shared offline capability/tool surface. Both arms dispatch through these
// exact definitions: the Core runtime invokes `execute` via its own invoke
// path, the benchmark shim invokes the same `execute` directly. Calls are
// recorded with CALL intervals measured on the fixture clock around the real
// execution. No network, no filesystem: an in-memory note store.
export const CAPABILITY_DEFS = [
  {
    name: 'record_note',
    description: 'Store a short observation note for this attempt.',
    mutatesCandidate: false
  },
  {
    name: 'fetch_note',
    description: 'Read back the most recent observation note.',
    mutatesCandidate: false
  }
];

export function createSharedCapabilities({ clock, callLog }) {
  const notes = [];
  const implementations = {
    async record_note(input) {
      const text = typeof input?.text === 'string' ? input.text : '';
      notes.push(text);
      return { stored: true, length: notes.length };
    },
    async fetch_note() {
      return { text: notes.length ? notes[notes.length - 1] : null, length: notes.length };
    }
  };
  return CAPABILITY_DEFS.map((def) => ({
    ...def,
    async execute(input) {
      const started = clock.now();
      const output = await implementations[def.name](input ?? null);
      const step = clock.tickCall();
      callLog.push({ capability: def.name, input: input ?? null, intervalMs: step, startedMs: started });
      return output;
    }
  }));
}

export function capabilityViews() {
  return CAPABILITY_DEFS.map((def) => ({ ...def }));
}
