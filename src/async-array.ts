export class AsyncArray<ItemType> {
  private arr: ItemType[] = [];
  private waiting: Array<(item: ItemType) => unknown> = [];

  get length() {
    return this.arr.length;
  }

  public get = (): Promise<ItemType> => {
    const item = this.arr.shift();
    if (item) {
      return Promise.resolve(item);
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  };

  public push(item: ItemType) {
    const next = this.waiting.shift();

    if (next) {
      // Make sure to push off the event to the next event loop
      setImmediate(next, item);
      return;
    }

    this.arr.push(item);
  }

  public map(
    cb: (value: ItemType, index: number, array: ItemType[]) => unknown,
    thisArg?: any,
  ) {
    return this.arr.map(cb, thisArg);
  }
}
