// Benchmark-owned scripted JavaScript session executor. Implements the real
// executor contract ({ open -> { features, execute, close } }) around a
// per-task cell script. Cell handlers perform real CALL_CAPABILITY host
// requests through the strategy's host bridge, so tool calls flow through the
// genuine orchestration path of whichever arm drives the strategy. The
// terminal cell issues a real in-session return_result; nothing here judges
// quality — the independent evaluator step does that later from the artifact.
import {
  JavaScriptHostRequestType,
  JavaScriptSessionFeature,
  isJavaScriptTerminalInterrupt
} from '../../../packages/core-harness/src/index.js';

// script: { cells: { [code]: { toolCalls: [{ capability, input }], stdout } },
//           terminalCode, terminalValue }
export function createScriptedExecutor({ script }) {
  const metrics = { opens: 0, closes: 0, executes: 0, codes: [] };
  return {
    metrics,
    async open(args) {
      metrics.opens += 1;
      const { host } = args;
      return {
        features: [JavaScriptSessionFeature.CELL_ABORT],
        async execute(request) {
          metrics.executes += 1;
          metrics.codes.push(request.code);
          try {
            if (request.code === script.terminalCode) {
              await host.request({
                type: JavaScriptHostRequestType.RETURN_RESULT,
                value: script.terminalValue
              });
              throw new Error('unreachable: return_result must terminate the cell');
            }
            const cell = script.cells[request.code];
            if (!cell) throw new SyntaxError(`unknown fixture cell: ${request.code}`);
            for (const call of cell.toolCalls ?? []) {
              await host.request({
                type: JavaScriptHostRequestType.CALL_CAPABILITY,
                name: call.capability,
                input: call.input ?? null
              });
            }
            return { stdout: cell.stdout ?? '', stderr: '', value: null };
          } catch (error) {
            if (isJavaScriptTerminalInterrupt(error)) {
              return { stdout: '', stderr: '', value: null, terminated: true };
            }
            throw error;
          }
        },
        async close() {
          metrics.closes += 1;
        }
      };
    }
  };
}
