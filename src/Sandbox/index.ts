import { ChildProcess, fork } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { getDebug } from '../utils';
import {
  IConfig,
  IMessage,
} from '../types';

const kill = require('tree-kill');
const debug = getDebug('sandbox');

export class BrowserlessSandbox extends EventEmitter {
  private child: ChildProcess;
  private timer: NodeJS.Timer | null;

  constructor({ code, timeout, opts, sandboxOpts }: IConfig) {
    super();

    this.child = fork(path.join(__dirname, 'child'));
    this.timer = timeout === -1 ? null : setTimeout(() => {
      debug(`Timeout reached, killing child process`);
      this.close();
    }, timeout);

    this.child.on('message', (message: IMessage) => {
      if (message.event === 'launched') {
        debug(`Sandbox ready, forwarding location`);
        this.emit('launched', message.context);
      }

      if (message.event === 'error') {
        debug(`Sandbox crashed, closing`);
        this.emit('error', message.context);
        this.close();
      }
    });

    this.child.on('error', (err) => {
      debug(`Error in sandbox ${err.message}, closing`);
      this.close();
    });

    this.child.send({
      context: {
        code,
        opts,
        sandboxOpts,
      },
      event: 'start',
    });
  }

  public close() {
    this.timer && clearTimeout(this.timer);
    debug(`Closing child`);
    this.kill();
  }

  private kill() {
    kill(this.child.pid, 'SIGKILL');
  }
}
