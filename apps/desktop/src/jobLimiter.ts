/**
 * Caps how many FFmpeg jobs of one kind run at once. Every job is its own
 * process, so an unbounded burst — dropping thirty files, or a gesture that
 * fires per pointer-move — saturates the machine's cores and freezes the app
 * along with the rest of the desktop.
 */
export function createJobLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    // The waiter takes the slot synchronously inside release(), so the cap can
    // never be exceeded by a caller that checks `active` in between.
    return new Promise((resolve) =>
      waiting.push(() => {
        active++;
        resolve();
      }),
    );
  }

  function release(): void {
    active--;
    waiting.shift()?.();
  }

  return async function run<T>(job: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await job();
    } finally {
      release();
    }
  };
}
