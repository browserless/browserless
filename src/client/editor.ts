import * as monaco from 'monaco-editor';
import { initialCode } from './constants';

const nodeTypes = (require as any).context('!!raw-loader!@types/node/', true, /\.d.ts$/);
const pptrIdx = require('!!raw-loader!@types/puppeteer/index.d.ts');

export class Editor {
  private editor: monaco.editor.IStandaloneCodeEditor;

  constructor($editor: HTMLElement) {
    this.setupEditor();
    this.editor = monaco.editor.create($editor, {
      value: initialCode,
      language: 'typescript',
      theme: 'vs-dark',
      fontSize: 14,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      minimap: {
        enabled: false
      }
    });
  }

  public async getCompiledCode() {
    await new Promise((r) => setTimeout(r, 1000));
    const model = this.editor.getModel();
    if (!model) {
        throw new Error(`Couldn't successfully load editor's contents`);
    }
    const { uri } = model;
    const worker = await monaco.languages.typescript.getTypeScriptWorker();
    const client = await worker(uri);
    const result = await client.getEmitOutput(uri.toString());
    const [{ text }] = result.outputFiles;

    return text;
  }

  private setupEditor() {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
    });

    nodeTypes.keys().forEach((key: string) => {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        nodeTypes(key).default,
        'node_modules/@types/node/' + key.substr(2)
      );
    });

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      pptrIdx.default
        .replace('import { ChildProcess } from \'child_process\';', '')
        .replace(/export /g, 'declare '),
      'node_modules/@types/puppeteer/index.d.ts',
    );

    // @ts-ignore
    self.MonacoEnvironment = {
      getWorkerUrl: (_moduleId: any, label: string) => {
        if (label === 'typescript' || label === 'javascript') {
          return './ts.worker.bundle.js';
        }
        return './editor.worker.bundle.js';
      }
    };
  }
}
