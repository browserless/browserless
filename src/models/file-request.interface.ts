import * as express from 'express';

export interface IFileRequest extends express.Request {
  file: any
}
