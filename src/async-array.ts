type ListenerFn<TArgs extends unknown[]> = (
  ...args: TArgs
) => unknown | Promise<unknown>;

export class AsyncArray {
  private arr: any[] = [];
  private waiting: ListenerFn<unknown[]>[] = [];

  get length() {
    return this.arr.length;
  }

  public get = () => {
    const item = this.arr.shift();
    if (item) {
      return Promise.resolve(item);
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  };

  public push(item: unknown) {
    const next = this.waiting.shift();

    if (next) {
      // Make sure to push off the event to the next event loop
      setImmediate(next, item);
      return;
    }

    this.arr.push(item);
  }

  public map(
    cb: (value: any, index: number, array: any[]) => unknown,
    thisArg?: any,
  ) {
    return this.arr.map(cb, thisArg);
  }
}
