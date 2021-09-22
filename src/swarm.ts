type Unwrapped<T> = T extends Promise<infer U> ? U : T;

export class Swarm<T extends () => Promise<any>, V = Unwrapped<ReturnType<T>>> {
  private generator: T;
  private quantity: number;
  private items: V[];
  private addListeners: ((items: V) => void)[];

  constructor(generator: T, quantity: number) {
    this.generator = generator;
    this.quantity = quantity;

    this.items = [];
    this.addListeners = [];
  }

  static waitForPropagation = () => new Promise((r) => setImmediate(r));

  private addNewItem = (item: V): void => {
    if (this.addListeners.length) {
      const addFunc = this.addListeners.shift();
      if (addFunc) {
        addFunc(item);
        return;
      }
    }

    this.items.push(item);
  };

  public start = async () => {
    await Promise.all(
      [...new Array(this.quantity)].map(() => this.generator()),
    ).then((items) => (this.items = items));

    if (this.addListeners.length) {
      const runQuantity = Math.min(this.items.length, this.addListeners.length);
      const listeners = this.addListeners.splice(0, runQuantity);
      listeners.forEach((listener) => {
        const item = this.items.shift();

        if (item) {
          listener(item);
        }
      });
    }
  };

  public get = async (): Promise<V> => {
    if (this.items.length) {
      const shifted = this.items.shift();
      if (shifted) {
        return Promise.resolve(shifted);
      }
    }

    return new Promise((resolve) => {
      this.addListeners.push((item) => resolve(item));
    });
  };

  public create = async () => {
    const item = await this.generator();

    this.addNewItem(item);

    return Swarm.waitForPropagation();
  };

  public add = (item: Unwrapped<ReturnType<T>>) => {
    this.addNewItem(item);

    return Swarm.waitForPropagation();
  };
}
