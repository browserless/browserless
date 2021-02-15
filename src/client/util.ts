export type SideEffectFn = (...args: any[]) => void;

export type Options = {
  isImmediate?: boolean;
  maxWait?: number;
};

export interface DebouncedFunction<F extends SideEffectFn> {
  (this: ThisParameterType<F>, ...args: Parameters<F>): void;
  cancel: () => void;
}

export function debounce<F extends SideEffectFn>(
  func: F,
  waitMilliseconds = 50,
  options: Options = {}
): DebouncedFunction<F> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const isImmediate = options.isImmediate ?? false;
  const maxWait = options.maxWait;
  let lastInvokeTime = Date.now();

  function nextInvokeTimeout() {
    if (maxWait !== undefined) {
      const timeSinceLastInvocation = Date.now() - lastInvokeTime;

      if (timeSinceLastInvocation + waitMilliseconds >= maxWait) {
        return maxWait - timeSinceLastInvocation;
      }
    }

    return waitMilliseconds;
  }

  const debouncedFunction = function (
    this: ThisParameterType<F>,
    ...args: Parameters<F>
  ) {
    const context = this;

    const invokeFunction = function invokeFunction () {
      timeoutId = undefined;
      lastInvokeTime = Date.now();
      if (!isImmediate) {
        func.apply(context, args);
      }
    };

    const shouldCallNow = isImmediate && timeoutId === undefined;

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(invokeFunction, nextInvokeTimeout());

    if (shouldCallNow) {
      func.apply(context, args);
    }
  };

  debouncedFunction.cancel = function cancel () {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  };

  return debouncedFunction;
}
