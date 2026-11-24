/**
 * A queue that runs each call after the previous one settles, so read-modify-write steps on one file never
 * interleave within a process. A failed call doesn't stop the ones after it.
 */
export const serialQueue = (): (<T>(work: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
};
