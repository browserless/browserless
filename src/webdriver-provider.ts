import { IQueue } from "./models/queue.interface";

export class WebDriver {
  private queue: IQueue<IJob>;

  constructor(queue) {
    this.queue = queue;
  }

  public start(sessionId: string) {
    this.queue.addJob();
  }
}
