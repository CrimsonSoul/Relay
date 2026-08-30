import { app } from 'electron';
import recoveryTiming from '../../../build/windows/recovery-timing.json';
import { loggers } from '../logger';
import { startManualUpdateCheckpointProcess } from './ManualUpdateCheckpointProcess';

export function startProductionManualUpdateCheckpointProcess(transactionId: string): void {
  startManualUpdateCheckpointProcess({
    whenReady: () => app.whenReady(),
    runCheckpoint: async () => {
      const { runProductionManualUpdateCheckpoint } =
        await import('./productionManualUpdateCheckpoint');
      await runProductionManualUpdateCheckpoint(transactionId);
    },
    exit: (code) => app.exit(code),
    reportFailure: (error) => loggers.main.error('Manual update checkpoint failed', { error }),
    timeoutMs: recoveryTiming.supervisorTimeoutMs,
  });
}
