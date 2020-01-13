import { EventEmitter } from 'events';

export class EventArray extends EventEmitter {
  private arr: any[];

  constructor() {
    super();
    this.arr = [];
  }

  get length() {
    return this.arr.length;
  }

  public push(item: any) {
    this.arr.push(item);

    // Make sure to push off the event to the next event loop
    setImmediate(this.emit.bind(this), 'push', item);
  }

  public shift() {
    const el = this.arr.shift();
    this.emit('shift', el);
    return el;
  }

  public map(cb: (value: any, index: number, array: any[]) => unknown, thisArg?: any) {
    return this.arr.map(cb, thisArg);
  }
}
