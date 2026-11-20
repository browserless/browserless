import {
  DocumentNode,
  ExecutionArgs,
  ExecutionResult,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLOutputType,
  GraphQLSchema,
  GraphQLSkipDirective,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  execute,
  getDirectiveValues,
  getNamedType,
  getNullableType,
  getOperationAST,
  getVariableValues,
  isListType,
  parse,
  validate,
  validateExecutionArgs,
  visit,
} from 'graphql';
import { ExecutorThrowingOnIncremental } from 'graphql/execution/ExecutorThrowingOnIncremental.js';
import { executionError } from './errors.js';
import { isAsyncIterable } from 'graphql/jsutils/isAsyncIterable.js';
import { isIterableObject } from 'graphql/jsutils/isIterableObject.js';
import { returnIteratorCatchingErrors } from 'graphql/execution/returnIteratorCatchingErrors.js';

type SyncListArgs = Parameters<
  ExecutorThrowingOnIncremental['completeIterableValue']
>;
type AsyncListArgs = Parameters<
  ExecutorThrowingOnIncremental['completeAsyncIterableValue']
>;

// These scheduling hooks are internal to the exact graphql version in package.json.
// GraphQL still owns field collection, type checks, completion and error propagation.
class MutationExecutor extends ExecutorThrowingOnIncremental {
  private readonly directMutationPaths = new WeakSet<object>();
  private readonly observedLists = new WeakSet<object>();

  override completeObjectValue(
    ...args: Parameters<ExecutorThrowingOnIncremental['completeObjectValue']>
  ) {
    const [, , info, path] = args;
    // executeFields receives the runtime type, which may have come from a union
    // or interface. Only opt in when the field declares Mutation as its result.
    if (getNamedType(info.returnType) === info.schema.getMutationType())
      this.directMutationPaths.add(path);
    return super.completeObjectValue(...args);
  }

  override executeFields(
    ...args: Parameters<ExecutorThrowingOnIncremental['executeFields']>
  ) {
    return args[2] && this.directMutationPaths.has(args[2])
      ? this.executeFieldsSerially(...args)
      : super.executeFields(...args);
  }

  override completeIterableValue(...args: SyncListArgs) {
    const [type, , info, , items] = args;
    if (getNamedType(type) !== info.schema.getMutationType())
      return super.completeIterableValue(...args);

    // Observe all eager rejections immediately, even if an earlier non-null
    // item fails and later items never get a turn. Keep the original rejection.
    args[4] = this.observeItems(items, type);
    return this.serialItems(...args);
  }

  private observeItems(
    items: Iterable<unknown>,
    itemType: GraphQLOutputType,
  ): Iterable<unknown> {
    if (this.observedLists.has(items)) return items;
    const type = getNullableType(itemType);
    const pending = Array.from(items, (item) => {
      let promise = Promise.resolve(item);
      if (isListType(type))
        promise = promise.then((value: unknown) => {
          // Leave invalid values and async iterables to native list completion.
          if (!isAsyncIterable(value) && isIterableObject(value))
            return this.observeItems(value, type.ofType);
          return value;
        });
      void promise.catch(() => {});
      return promise;
    });
    // Native completion revisits each buffered row; never consume its source twice.
    this.observedLists.add(pending);
    return pending;
  }

  override completeAsyncIterableValue(...args: AsyncListArgs) {
    return getNamedType(args[0]) === args[2].schema.getMutationType()
      ? this.serialItems(...args)
      : super.completeAsyncIterableValue(...args);
  }

  private async serialItems(
    ...[type, fields, info, path, items, position]: SyncListArgs | AsyncListArgs
  ) {
    const results: unknown[] = [];
    const append = async (item: unknown) => {
      const itemPath = { prev: path, key: results.length, typename: undefined };
      results.push(
        await this.completePromisedListItemValue(
          Promise.resolve(item),
          type,
          fields,
          info,
          itemPath,
          position,
        ),
      );
    };
    // for-await would unwrap a rejected array item before GraphQL could apply
    // the item's nullability. Async iterators also need closing on abrupt exit.
    if (Symbol.asyncIterator in items) {
      const iterator = items[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          if (this.aborted) throw new Error('Aborted!');
          await append(next.value);
        }
      } catch (error) {
        this.sharedExecutionContext.asyncWorkTracker.add(
          returnIteratorCatchingErrors(iterator),
        );
        throw error;
      }
    } else for (const item of items) await append(item);
    return results;
  }
}

async function executeMutation(args: ExecutionArgs): Promise<ExecutionResult> {
  // Let execute enforce its schema-level incremental directive guard too.
  if (args.schema.getDirective('defer') || args.schema.getDirective('stream'))
    return execute(args);
  const validated = validateExecutionArgs(args);
  return 'schema' in validated
    ? new MutationExecutor(validated).executeRootSelectionSet()
    : { errors: validated };
}

/** A service may preserve partial results or stop after a particular mutation. */
export type MutationResultPolicy = (
  field: string,
  result: ExecutionResult,
) => 'continue' | 'stop' | undefined;

/** Execute mutations in document order, replacing string AST values, never source text. */
export async function executeWithChaining(
  schema: GraphQLSchema,
  document: string | DocumentNode,
  rootValue: unknown,
  contextValue: unknown,
  variableValues?: Record<string, unknown> | null,
  operationName?: string,
  mutationResultPolicy?: MutationResultPolicy,
  legacyMutationSemantics = false,
): Promise<ExecutionResult> {
  variableValues ??= {};
  let ast: DocumentNode;
  try {
    ast = typeof document === 'string' ? parse(document) : document;
  } catch (error) {
    return { errors: [executionError(error)] };
  }
  const errors = [...validate(schema, ast)];
  if (errors.length) return { errors };
  const operation = legacyMutationSemantics
    ? (ast.definitions.find(
        (node): node is OperationDefinitionNode =>
          node.kind === Kind.OPERATION_DEFINITION &&
          node.operation === 'mutation',
      ) ?? getOperationAST(ast))
    : getOperationAST(ast, operationName);
  if (operation?.operation === 'subscription')
    return {
      errors: [
        executionError(new Error('Subscriptions require graphql-transport-ws')),
      ],
    };
  const args = {
    schema,
    document: ast,
    rootValue,
    contextValue,
    variableValues,
    operationName: legacyMutationSemantics ? undefined : operationName,
  };
  if (!operation || operation.operation !== 'mutation') return execute(args);

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of ast.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION)
      fragments.set(definition.name.value, definition);
  }
  const coerced = getVariableValues(
    schema,
    operation.variableDefinitions ?? [],
    variableValues,
  );
  if (coerced.errors) {
    if (!legacyMutationSemantics) return { errors: coerced.errors };
    const errors: GraphQLError[] = [];
    for (const field of operation.selectionSet.selections) {
      if (field.kind !== Kind.FIELD) continue;
      errors.push(...coerced.errors);
      if (
        mutationResultPolicy?.(field.name.value, { errors: coerced.errors }) ===
        'stop'
      )
        break;
    }
    return { data: {}, ...(errors.length ? { errors } : {}) };
  }
  const variables = coerced.variableValues;
  function fields(set: SelectionSetNode): FieldNode[] {
    return set.selections.flatMap((selection) => {
      if (
        getDirectiveValues(GraphQLSkipDirective, selection, variables)?.if ===
          true ||
        getDirectiveValues(GraphQLIncludeDirective, selection, variables)
          ?.if === false
      )
        return [];
      if (selection.kind === Kind.FIELD) return [selection];
      const nested =
        selection.kind === Kind.INLINE_FRAGMENT
          ? selection
          : fragments.get(selection.name.value);
      return nested ? fields(nested.selectionSet) : [];
    });
  }
  const exports: Record<string, unknown> = Object.create(null);
  const data: Record<string, unknown> = Object.create(null);
  function collect(set: SelectionSetNode, value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) collect(set, item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const field of fields(set)) {
      const result = (value as Record<string, unknown>)[
        field.alias?.value ?? field.name.value
      ];
      for (const directive of field.directives ?? []) {
        const name = directive.arguments?.find(
          (arg) => arg.name.value === 'as',
        )?.value;
        if (directive.name.value === 'export' && name?.kind === Kind.STRING)
          exports[name.value] = result;
      }
      if (field.selectionSet) collect(field.selectionSet, result);
    }
  }
  const selectionsToExecute = legacyMutationSemantics
    ? operation.selectionSet.selections.filter(
        (node): node is FieldNode => node.kind === Kind.FIELD,
      )
    : fields(operation.selectionSet);
  for (const field of selectionsToExecute) {
    const selections = [field];
    const single: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: [
        {
          ...operation,
          selectionSet: { kind: Kind.SELECTION_SET, selections },
        },
        ...fragments.values(),
      ],
    };
    const replaced = visit(single, {
      StringValue(node) {
        let value = node.value;
        for (const [name, exportedValue] of Object.entries(exports)) {
          value = value.replaceAll('${' + name + '}', () =>
            String(exportedValue),
          );
        }
        return { ...node, value };
      },
    });
    const result = await executeMutation({ ...args, document: replaced });
    if (result.errors) errors.push(...result.errors);
    const decision = mutationResultPolicy?.(selections[0].name.value, result);
    if (result.data === null && decision !== 'continue')
      return { data: null, errors };
    Object.assign(data, result.data);
    if (legacyMutationSemantics) {
      if (result.data) {
        const value = result.data[
          field.alias?.value ?? field.name.value
        ] as Record<string, unknown> | null;
        for (const child of field.selectionSet?.selections ?? []) {
          if (child.kind !== Kind.FIELD) continue;
          const directive = child.directives?.find(
            (d) => d.name.value === 'export',
          );
          const name = directive?.arguments?.find(
            (a) => a.name.value === 'as',
          )?.value;
          if (name?.kind === Kind.STRING)
            exports[name.value] =
              value?.[child.alias?.value ?? child.name.value];
        }
      }
    } else collect({ kind: Kind.SELECTION_SET, selections }, result.data);
    if (decision === 'stop') break;
  }
  return { data, ...(errors.length ? { errors } : {}) };
}
