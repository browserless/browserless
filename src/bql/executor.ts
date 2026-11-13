import {
  DocumentNode,
  ExecutionResult,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLIncludeDirective,
  GraphQLSchema,
  GraphQLSkipDirective,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  execute,
  getDirectiveValues,
  getOperationAST,
  getVariableValues,
  parse,
  validate,
  visit,
} from 'graphql';
import { executionError } from './errors.js';

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
    const errors = operation.selectionSet.selections.flatMap((selection) =>
      selection.kind === Kind.FIELD ? coerced.errors! : [],
    );
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
    const result = await execute({ ...args, document: replaced });
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
