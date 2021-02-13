import { Editor } from './editor';

const devtoolsMarkup = `
<div id="viewer">
  <canvas id="screencast">
  </canvas>
</div>
<div id="devtools">
  <iframe id="devtools-mount">
  </iframe>
</div>
`;

// @ts-ignore
const puppeteer = window.puppeteer;

export class App {
  private editor: Editor;

  private $runButton = document.querySelector('#run-button') as HTMLElement;
  private $runner = document.querySelector('#runner') as HTMLElement;
  private $verticalResizer = document.querySelector('#resize-main') as HTMLElement;
  private $codePanel = document.querySelector('#code') as HTMLElement;
  private client: any;
  private img = new Image();

  constructor (editor: Editor) {
    this.editor = editor;

    this.$runButton.addEventListener('click', this.run);
    this.$verticalResizer.addEventListener('mousedown', this.onMainResize);
  }

  static getModifiersForEvent(event: any) {
    // tslint:disable-next-line: no-bitwise
    return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
  }

  onMainResize = (evt: MouseEvent) => {
    evt.preventDefault();

    this.$runner.style.pointerEvents = 'none';

    let onMouseMove: any = (moveEvent: MouseEvent) => {
      if (moveEvent.buttons === 0) {
        return onMouseUp();
      }

      (this.$codePanel as any).style.width = `${moveEvent.clientX}px`;
    };

    let onMouseUp: any = () => {
      this.$runner.style.pointerEvents = 'initial';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      onMouseMove = null;
      onMouseUp = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  insertDevtools = () => {
    this.$runner.innerHTML = devtoolsMarkup;

    return document.querySelector('#devtools-mount') as HTMLIFrameElement;
  };

  drawFrame = (msg: string, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const img = this.img;

    this.img.onload = function drawCanvas() {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    this.img.src = 'data:image/png;base64,' + msg;
  };

  emitMouse = (evt: any) => {
    const buttons: any = { 0: 'none', 1: 'left', 2: 'middle', 3: 'right' };
    const event: any = evt.type === 'mousewheel' ? (window.event || evt) : evt;
    const types: any = {
      mousedown: 'mousePressed',
      mouseup: 'mouseReleased',
      mousewheel: 'mouseWheel',
      touchstart: 'mousePressed',
      touchend: 'mouseReleased',
      touchmove: 'mouseWheel',
      mousemove: 'mouseMoved',
    };

    if (!(event.type in types)) {
      return;
    }

    if (
      event.type !== 'mousewheel' &&
      buttons[event.which] === 'none' &&
      event.type !== 'mousemove'
    ) {
      return;
    }

    const type = types[event.type] as string;
    const isScroll = type.indexOf('wheel') !== -1;
    const x = isScroll ? event.clientX : event.offsetX;
    const y = isScroll ? event.clientY : event.offsetY;

    const params = {
      type: types[event.type],
      x,
      y,
      modifiers: App.getModifiersForEvent(event),
      button: event.type === 'mousewheel' ? 'none' : buttons[event.which],
      clickCount: 1
    };

    if (event.type === 'mousewheel') {
      // @ts-ignore
      params.deltaX = event.wheelDeltaX || 0;
      // @ts-ignore
      params.deltaY = event.wheelDeltaY || event.wheelDelta;
    }

    this.client.send('Input.emulateTouchFromMouseEvent', params);
  };

  emitKeyEvent = (event: KeyboardEvent) => {
    let type;

    // Prevent backspace from going back in history
    if (event.keyCode === 8) {
      event.preventDefault();
    }

    switch (event.type) {
      case 'keydown':
        type = 'keyDown';
        break;
      case 'keyup':
        type = 'keyUp';
        break;
      case 'keypress':
        type = 'char';
        break;
      default:
        return;
    }

    const text = type === 'char' ? String.fromCharCode(event.charCode) : undefined;
    const params = {
      type,
      text,
      unmodifiedText: text ? text.toLowerCase() : undefined,
      keyIdentifier: (event as any).keyIdentifier,
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: event.keyCode,
      nativeVirtualKeyCode: event.keyCode,
      autoRepeat: false,
      isKeypad: false,
      isSystemKey: false
    };

    this.client.send('Input.dispatchKeyEvent', params);
  };

  bindKeyEvents = () => {
    document.body.addEventListener('keydown', this.emitKeyEvent, true);
    document.body.addEventListener('keyup', this.emitKeyEvent, true);
    document.body.addEventListener('keypress', this.emitKeyEvent, true);
  };

  unbindKeyEvents = () => {
    document.body.removeEventListener('keydown', this.emitKeyEvent, true);
    document.body.removeEventListener('keyup', this.emitKeyEvent, true);
    document.body.removeEventListener('keypress', this.emitKeyEvent, true);
  };

  addListeners = ($el: Element) => {
    $el.addEventListener('mousedown', this.emitMouse, false);
    $el.addEventListener('mouseup', this.emitMouse, false);
    $el.addEventListener('mousewheel', this.emitMouse, false);
    $el.addEventListener('mousemove', this.emitMouse, false);

    $el.addEventListener('mouseenter', this.bindKeyEvents, false);
    $el.addEventListener('mouseleave', this.unbindKeyEvents, false);
  };

  run = async () => {
    const code = await this.editor.getCompiledCode();
    const $inject = this.insertDevtools();

    const $viewer = document.querySelector('#viewer') as Element;
    const $canvas = document.querySelector('#screencast') as HTMLCanvasElement;

    const { width, height } = $viewer.getBoundingClientRect();
    const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://localhost:3000' });
    const [page] = await browser.pages();
    const ctx = $canvas.getContext('2d') as CanvasRenderingContext2D;

    this.addListeners($canvas);
    this.client = page._client;
    $inject.src = `http://localhost:3000/devtools/devtools_app.html?ws=localhost:3000/devtools/page/${page._target._targetId}`;
    $canvas.width = width;
    $canvas.height = height;

    await page.setViewport({
      width: Math.floor(width),
      height: Math.floor(height),
      deviceScaleFactor: 0.5,
    });

    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 100,
      maxWidth: Math.floor(width),
      maxHeight: Math.floor(height),
    });

    this.client.on('Page.screencastFrame', ({ data, sessionId }: { data: string; sessionId: string }) => {
      this.client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      this.drawFrame(data, $canvas, ctx);
    });

    // tslint:disable-next-line: no-eval
    eval(code)({ page });
  };
}
