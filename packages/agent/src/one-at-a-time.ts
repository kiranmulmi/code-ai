/**
 * A queue that runs async calls one at a time, in the order they came. Sub-agents can work at
 * the same time, but a person answers one prompt at a time: the CLI has one terminal line, and
 * the web chat shows one question at a time. Calls passed through the same queue wait for the
 * one before to finish, so two prompts never mix.
 */
export function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    // The next call waits for this one, whether it worked or failed.
    tail = result.catch(() => undefined);
    return result;
  };
}
