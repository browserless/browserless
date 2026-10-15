import {
  DocumentNode,
  ExecutionResult,
  GraphQLSchema,
  parse,
  subscribe,
  validate,
} from 'graphql';

import { APIFactory, BQLContextOptions, Context } from './context.js';
import { MutationResultPolicy, executeWithChaining } from './executor.js';
import { BQLBrowserAPI } from './api/browser-api.js';
import type { BQLModule } from './module.js';
import { buildBQLSchema } from './schema/build.js';
import { executionError } from './errors.js';
import { readFileSync } from 'node:fs';

export interface BQLRequest {
  query: string | DocumentNode;
  variables?: Record<string, unknown> | null;
  operationName?: string;
}

export interface BrowserQLOptions<API extends BQLBrowserAPI = BQLBrowserAPI> {
  modules?: BQLModule<API>[];
  apiFactory?: APIFactory<API>;
  capabilities?: string[];
  mutationResultPolicy?: MutationResultPolicy;
}

export class BrowserQL<API extends BQLBrowserAPI = BQLBrowserAPI> {
  public readonly schema: GraphQLSchema;
  public readonly capabilities: string[];
  public readonly version: string = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ).version;
  private readonly apiFactory: APIFactory<API>;
  private readonly mutationResultPolicy?: MutationResultPolicy;

  constructor({
    modules = [],
    apiFactory = (options) => new BQLBrowserAPI(options) as API,
    capabilities = [],
    mutationResultPolicy,
  }: BrowserQLOptions<API> = {}) {
    this.apiFactory = apiFactory;
    this.mutationResultPolicy = mutationResultPolicy;
    this.capabilities = [
      ...new Set([
        'core',
        ...modules.map((module) => module.name),
        ...capabilities,
      ]),
    ];
    this.schema = buildBQLSchema(modules, {
      version: () => this.version,
      capabilities: () => this.capabilities,
      browser: async (_source, _args, context) =>
        (
          await (
            await context.getBrowser()
          ).browserCDP.send('Browser.getVersion')
        ).product,
    });
  }

  public createContext(options: BQLContextOptions): Context<API> {
    return new Context(options, this.apiFactory);
  }

  public execute(
    request: BQLRequest,
    context: Context,
  ): Promise<ExecutionResult> {
    return executeWithChaining(
      this.schema,
      request.query,
      undefined,
      context,
      request.variables,
      request.operationName,
      this.mutationResultPolicy,
    );
  }

  public async subscribe(
    request: BQLRequest,
    context: Context,
  ): Promise<AsyncIterable<ExecutionResult> | ExecutionResult> {
    try {
      const document =
        typeof request.query === 'string'
          ? parse(request.query)
          : request.query;
      const errors = validate(this.schema, document);
      if (errors.length) return { errors };
      return await subscribe({
        schema: this.schema,
        document,
        contextValue: context,
        variableValues: request.variables,
        operationName: request.operationName,
      });
    } catch (error) {
      return { errors: [executionError(error)] };
    }
  }
}

export default BrowserQL;
