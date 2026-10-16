import { GraphQLError } from 'graphql';

export const executionError = (error: unknown): GraphQLError =>
  error instanceof GraphQLError
    ? error
    : new GraphQLError(error instanceof Error ? error.message : String(error));
