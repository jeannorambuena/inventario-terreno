export const temporaryConnectionMessage = 'Conexión temporalmente interrumpida. Intentando reconectar…';

export function isIntentionalAbort(error) {
  return error?.name === 'AbortError';
}

export function createSafeNetworkError() {
  const error = new Error('No fue posible conectar temporalmente con el notebook.');
  error.isNetworkError = true;
  return error;
}

export function createPollingFailureTracker({ threshold = 2 } = {}) {
  let consecutiveFailures = 0;
  let warningVisible = false;
  let terminal = false;

  return {
    recordFailure(error) {
      if (terminal || isIntentionalAbort(error)) return { action: 'ignore' };
      if ([401, 403, 410].includes(error?.status)) {
        terminal = true;
        return { action: 'terminal', error };
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold) {
        warningVisible = true;
        return { action: 'warn', message: temporaryConnectionMessage };
      }
      return { action: 'retry' };
    },

    recordSuccess() {
      if (terminal) return { action: 'ignore' };
      const shouldClearWarning = warningVisible;
      consecutiveFailures = 0;
      warningVisible = false;
      return { action: shouldClearWarning ? 'clear-warning' : 'connected' };
    },

    markTerminal() {
      terminal = true;
    },

    get consecutiveFailures() {
      return consecutiveFailures;
    },

    get isTerminal() {
      return terminal;
    },
  };
}
