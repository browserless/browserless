const path = require('path');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');


const srcDir = path.resolve(__dirname, 'src', 'client');
const outputDir = path.resolve(__dirname, 'dist');

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: {
    app: path.join(srcDir, 'index.ts'),
    'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
    'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    globalObject: 'self',
    filename: '[name].bundle.js',
    path: outputDir,
  },
  externals: {
    puppeteer: 'puppeteer'
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ttf$/,
        use: ['file-loader']
      },
      {
        test: /\.txt$/i,
        use: 'raw-loader',
      },
    ],
  },
  plugins: [
    new HtmlWebPackPlugin({
      title: 'browserless debugger',
      template: path.join(srcDir, 'index.html'),
    }),
    new CopyPlugin({
      patterns: [{
        from: path.join(srcDir, 'puppeteer.js'),
        to: path.join(outputDir, 'puppeteer.js'),
      }],
    }),
  ],
};
