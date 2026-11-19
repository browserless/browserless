import {
  DocumentNode,
  ExecutionArgs,
  ExecutionResult,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLNullableOutputType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLSkipDirective,
  GraphQLUnionType,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  TypeInfo,
  defaultFieldResolver,
  execute,
  getDirectiveValues,
  getNamedType,
  getOperationAST,
  getVariableValues,
  isInterfaceType,
  isIntrospectionType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  locatedError,
  parse,
  responsePathAsArray,
  validate,
  visit,
  visitWithTypeInfo,
} from 'graphql';
import { executionError } from './errors.js';

/**
 * Execute nested Mutation selections as root mutations using graphql-js's public
 * executor. The execution-only scalar holds completed branches, so GraphQL never
 * runs their resolvers or scalar coercion a second time. Public validation and
 * introspection continue to use the original schema.
 */
function serialExecutor(schema: GraphQLSchema) {
  const mutation = schema.getMutationType()!;
  const types = new Map<GraphQLNamedType, GraphQLNamedType>();
  let scalarName = '_BQLCompletedMutation';
  while (schema.getType(scalarName)) scalarName += '_';
  const completed = new GraphQLScalarType({
    name: scalarName,
    serialize(value) {
      if (value instanceof GraphQLError) throw value;
      return value;
    },
  });
  type Root = {
    value: unknown;
    args: ExecutionArgs;
    nodes: WeakMap<FieldNode, FieldNode>;
    errors: GraphQLError[];
    prefix: readonly (string | number)[];
    originalRoot: unknown;
    operation: OperationDefinitionNode;
    fragments: Record<string, FragmentDefinitionNode>;
    variables?: GraphQLResolveInfo['variableValues'];
  };

  function resolverPath(
    path: GraphQLResolveInfo['path'],
    prefix: readonly (string | number)[],
  ): GraphQLResolveInfo['path'] {
    let prev: GraphQLResolveInfo['path'] | undefined;
    for (const key of [...prefix, ...responsePathAsArray(path)])
      prev = { prev, key, typename: undefined };
    return { ...path, prev: prev!.prev };
  }

  function output(type: GraphQLOutputType): GraphQLOutputType {
    if (isNonNullType(type))
      return new GraphQLNonNull(
        output(type.ofType) as GraphQLNullableOutputType,
      );
    if (isListType(type)) return new GraphQLList(output(type.ofType));
    return type === mutation ? completed : (named(type) as GraphQLOutputType);
  }
  function named(type: GraphQLNamedType): GraphQLNamedType {
    if (isIntrospectionType(type)) return type;
    const cached = types.get(type);
    if (cached) return cached;
    if (isObjectType(type) || isInterfaceType(type)) {
      const config = type.toConfig();
      const replacement = {
        interfaces: () =>
          config.interfaces.map((item) => named(item) as GraphQLInterfaceType),
        fields: () =>
          Object.fromEntries(
            Object.entries(config.fields).map(([name, field]) => [
              name,
              {
                ...field,
                type: output(field.type),
                resolve(
                  source: unknown,
                  args: Record<string, unknown>,
                  context: unknown,
                  info: GraphQLResolveInfo,
                ) {
                  const root = info.rootValue as Root;
                  const fieldNodes = info.fieldNodes.map(
                    (node) => root.nodes.get(node) ?? node,
                  );
                  const value = (field.resolve ?? defaultFieldResolver)(
                    source === root ? root.value : source,
                    args,
                    context,
                    {
                      ...info,
                      schema,
                      parentType: type as GraphQLObjectType,
                      returnType: field.type,
                      fieldNodes,
                      rootValue: root.originalRoot,
                      path: resolverPath(info.path, root.prefix),
                      operation: root.operation,
                      fragments: root.fragments,
                      variableValues: (root.variables ??= info.variableValues),
                    },
                  );
                  if (getNamedType(field.type) !== mutation) return value;
                  const selectionSet: SelectionSetNode = {
                    kind: Kind.SELECTION_SET,
                    selections: fieldNodes.flatMap(
                      (node) => node.selectionSet?.selections ?? [],
                    ),
                  };
                  async function complete(
                    value: unknown,
                    type: GraphQLOutputType,
                    path: readonly (string | number)[],
                  ): Promise<unknown> {
                    try {
                      value = await value;
                      if (value instanceof Error) throw value;
                      if (value == null) return value;
                      if (isNonNullType(type))
                        return complete(value, type.ofType, path);
                      if (isListType(type)) {
                        const results: unknown[] = [];
                        const append = async (item: unknown) => {
                          results.push(
                            await complete(item, type.ofType, [
                              ...path,
                              results.length,
                            ]),
                          );
                        };
                        if (Symbol.asyncIterator in Object(value)) {
                          for await (const item of value as AsyncIterable<unknown>)
                            await append(item);
                        } else if (Symbol.iterator in Object(value)) {
                          // Observe every item rejection before awaiting earlier actions.
                          const items = Array.from(
                            value as Iterable<unknown>,
                            (item, index) =>
                              Promise.resolve(item).catch((error) =>
                                locatedError(error, fieldNodes, [
                                  ...path,
                                  index,
                                ]),
                              ),
                          );
                          for (const item of items) await append(item);
                        } else return value;
                        return results;
                      }
                      const document: DocumentNode = {
                        kind: Kind.DOCUMENT,
                        definitions: [
                          { ...info.operation, selectionSet },
                          ...Object.values(root.fragments),
                        ],
                      };
                      const result = await run(
                        { ...root.args, document, rootValue: value },
                        {
                          prefix: [...root.prefix, ...path],
                          originalRoot: root.originalRoot,
                          operation: root.operation,
                          variables: root.variables,
                        },
                      );
                      const errors =
                        result.errors?.map(
                          (error) =>
                            new GraphQLError(error.message, {
                              nodes: error.nodes,
                              source: error.source,
                              positions: error.positions,
                              path: [...path, ...(error.path ?? [])],
                              originalError: error.originalError,
                              extensions: error.extensions,
                            }),
                        ) ?? [];
                      root.errors.push(...errors);
                      return result.data === null ? errors[0] : result.data;
                    } catch (error) {
                      return locatedError(error, fieldNodes, path);
                    }
                  }
                  return complete(
                    value,
                    field.type,
                    responsePathAsArray(info.path),
                  );
                },
              },
            ]),
          ),
      };
      const result = isObjectType(type)
        ? new GraphQLObjectType({ ...type.toConfig(), ...replacement })
        : new GraphQLInterfaceType({ ...type.toConfig(), ...replacement });
      types.set(type, result);
      return result;
    }
    if (isUnionType(type)) {
      const config = type.toConfig();
      const result = new GraphQLUnionType({
        ...config,
        types: () =>
          config.types.map((item) => named(item) as GraphQLObjectType),
      });
      types.set(type, result);
      return result;
    }
    return type;
  }
  const config = schema.toConfig();
  const executionSchema = new GraphQLSchema({
    ...config,
    query: config.query
      ? (named(config.query) as GraphQLObjectType)
      : undefined,
    mutation: named(mutation) as GraphQLObjectType,
    subscription: config.subscription
      ? (named(config.subscription) as GraphQLObjectType)
      : undefined,
    types: config.types.map(named),
  });
  async function run(
    args: ExecutionArgs,
    parent?: Pick<Root, 'prefix' | 'originalRoot' | 'operation' | 'variables'>,
  ): Promise<ExecutionResult> {
    const nodes = new WeakMap<FieldNode, FieldNode>();
    const info = new TypeInfo(schema);
    const document = visit(
      args.document,
      visitWithTypeInfo(info, {
        Field(node) {
          if (getNamedType(info.getType()) !== mutation) return;
          const leaf = { ...node, selectionSet: undefined };
          nodes.set(leaf, node);
          return leaf;
        },
      }),
    );
    const fragments = Object.fromEntries(
      args.document.definitions.flatMap((node) =>
        node.kind === Kind.FRAGMENT_DEFINITION ? [[node.name.value, node]] : [],
      ),
    );
    const root: Root = {
      value: args.rootValue,
      args,
      nodes,
      errors: [],
      fragments,
      ...(parent ?? {
        prefix: [],
        originalRoot: args.rootValue,
        operation: getOperationAST(args.document, args.operationName)!,
      }),
    };
    const result = await execute({
      ...args,
      schema: executionSchema,
      document,
      rootValue: root,
    });
    const errors = [...new Set([...root.errors, ...(result.errors ?? [])])];
    return { ...result, ...(errors.length ? { errors } : {}) };
  }
  return run;
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
  const executeSerially = serialExecutor(schema);
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
    const result = await executeSerially({ ...args, document: replaced });
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
