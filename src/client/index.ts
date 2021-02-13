
import './index.css';
import { Editor } from './editor';
import { App } from './app';

const $editor = document.getElementById('code');

if (!$editor) {
  throw new Error(`Couldn't find element to insert code editor!`);
}

const editor = new Editor($editor);
new App(editor);
