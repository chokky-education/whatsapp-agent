// Restart the process if a serialized mutation never returns. Releasing the queue
// while it still runs would let group deletion race the unfinished mutation.
export function createSerialQueue({
  timeoutMs,
  onStuck,
  observe = () => ({ start() {}, end() {} }),
}) {
  let tail = Promise.resolve();
  return (job) => {
    const observation = observe();
    const next = tail.then(async () => {
      observation.start();
      const timer = setTimeout(onStuck, timeoutMs);
      timer.unref?.();
      try {
        return await job();
      } finally {
        clearTimeout(timer);
        observation.end();
      }
    });
    tail = next.catch(() => {});
    return next;
  };
}
