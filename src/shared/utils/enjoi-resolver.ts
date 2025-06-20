/* global WeakMap */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as Bourne from '@hapi/bourne';
import * as Hoek from '@hapi/hoek';
import Joi from 'joi';

// Modern replacements for deprecated Node.js util functions
const isArray = Array.isArray;
const isObject = (value: any): value is object =>
  value && typeof value === 'object' && value.constructor === Object;
const isNumber = (value: any): value is number => typeof value === 'number';
const isUndefined = (value: any): value is undefined => value === undefined;

function randomString(length: number): string {
  return Math.round(
    Math.pow(36, length + 1) - Math.random() * Math.pow(36, length),
  )
    .toString(36)
    .slice(1);
}

interface SchemaResolverOptions {
  subSchemas?: Record<string, any>;
  refineType?: (type: string, format?: string) => string;
  refineSchema?: (joiSchema: any, jsonSchema: any) => any;
  strictMode?: boolean;
  useDefaults?: boolean;
  extensions?: any[];
}

interface JSONSchema {
  type?: string | string[];
  $ref?: string;
  properties?: Record<string, any>;
  format?: string;
  enum?: any[];
  anyOf?: any[];
  allOf?: any[];
  oneOf?: any[];
  not?: any;
  default?: any;
  required?: string[];
  additionalProperties?: boolean | any;
  minProperties?: number;
  maxProperties?: number;
  items?: any;
  ordered?: any;
  additionalItems?: boolean;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  [key: string]: any;
}

class SchemaResolver {
  private root: any;
  private subSchemas?: Record<string, any>;
  private refineType?: (type: string, format?: string) => string;
  private refineSchema?: (joiSchema: any, jsonSchema: any) => any;
  private strictMode?: boolean;
  private walkedSchemas: WeakMap<any, string>;
  private useDefaults?: boolean;
  private joi: any;

  constructor(
    root: any,
    {
      subSchemas,
      refineType,
      refineSchema,
      strictMode,
      useDefaults,
      extensions = [],
    }: SchemaResolverOptions = {},
  ) {
    this.root = root;
    this.subSchemas = subSchemas;
    this.refineType = refineType;
    this.refineSchema = refineSchema;
    this.strictMode = strictMode;
    this.walkedSchemas = new WeakMap(); // map of schemas iterated thus far to the generated id they were given
    this.useDefaults = useDefaults;

    this.joi = Joi.extend(
      {
        type: 'object',
        base: Joi.object(),
        coerce: {
          from: 'string',
          // @ts-ignore - Type compatibility issue with Joi coerce method
          method(value: any) {
            if (
              typeof value !== 'string' ||
              (value[0] !== '{' && !/^\s*\{/.test(value))
            ) {
              return;
            }

            try {
              return { value: Bourne.parse(value) };
            } catch (_) {
              return;
            } // eslint-disable-line no-empty
          },
        },
      },
      {
        type: 'array',
        base: Joi.array(),
        coerce: {
          from: 'string',
          method(value: any) {
            if (
              typeof value !== 'string' ||
              (value[0] !== '[' && !/^\s*\[/.test(value))
            ) {
              return;
            }
            try {
              return { value: Bourne.parse(value) };
            } catch (_) {
              return;
            } // eslint-disable-line no-empty
          },
        },
      },
      ...extensions,
    );
  }

  resolve(schema: any = this.root, ancestors: string[] = []): any {
    let resolvedSchema: any;
    let generatedId = this.walkedSchemas.get(schema);

    if (generatedId && ancestors.lastIndexOf(generatedId) > -1) {
      // resolve cyclic schema by using joi reference via generated unique ids
      return this.resolveLink(schema);
    } else if (typeof schema === 'object') {
      generatedId = randomString(10);
      this.walkedSchemas.set(schema, generatedId);
    }

    if (typeof schema === 'string') {
      // If schema is itself a string, interpret it as a type
      resolvedSchema = this.resolveType({ type: schema }, ancestors);
    } else if (schema.$ref) {
      resolvedSchema = this.resolve(
        this.resolveReference(schema.$ref),
        ancestors.concat(generatedId || ''),
      );
    } else {
      const partialSchemas: any[] = [];
      if (schema.type) {
        partialSchemas.push(
          this.resolveType(schema, ancestors.concat(generatedId || '')),
        );
      } else if (schema.properties) {
        // if no type is specified, just properties
        partialSchemas.push(
          this.object(schema, ancestors.concat(generatedId || '')),
        );
      } else if (schema.format) {
        // if no type is specified, just format
        partialSchemas.push(this.string(schema));
      } else if (schema.enum) {
        // If no type is specified, just enum
        partialSchemas.push(this.joi.any().valid(...schema.enum));
      }
      if (schema.anyOf) {
        partialSchemas.push(
          this.resolveAnyOf(schema, ancestors.concat(generatedId || '')),
        );
      }
      if (schema.allOf) {
        partialSchemas.push(
          this.resolveAllOf(schema, ancestors.concat(generatedId || '')),
        );
      }
      if (schema.oneOf) {
        partialSchemas.push(
          this.resolveOneOf(schema, ancestors.concat(generatedId || '')),
        );
      }
      if (schema.not) {
        partialSchemas.push(
          this.resolveNot(schema, ancestors.concat(generatedId || '')),
        );
      }
      if (partialSchemas.length === 0) {
        //Fall through to whatever.
        //eslint-disable-next-line no-console
        console.warn(
          "WARNING: schema missing a 'type' or '$ref' or 'enum': \n%s",
          JSON.stringify(schema, null, 2),
        );
        //TODO: Handle better
        partialSchemas.push(this.joi.any());
      }
      resolvedSchema =
        partialSchemas.length === 1
          ? partialSchemas[0]
          : this.joi.alternatives(partialSchemas).match('all');
    }

    if (generatedId) {
      // we have finished resolving the schema, now attach the id generated earlier
      resolvedSchema = resolvedSchema.id(this.walkedSchemas.get(schema));
    }

    if (this.refineSchema) {
      resolvedSchema = this.refineSchema(resolvedSchema, schema);
    }

    if (this.useDefaults && schema.default !== undefined) {
      resolvedSchema = resolvedSchema.default(schema.default);
    }

    return resolvedSchema;
  }

  resolveReference(value: string): any {
    let refschema: any;

    const id = value.substr(0, value.indexOf('#') + 1);
    const path = value.substr(value.indexOf('#') + 1);

    if (id && this.subSchemas) {
      refschema =
        this.subSchemas[id] || this.subSchemas[id.substr(0, id.length - 1)];
    }
    if (!refschema) {
      refschema = this.root;
    }

    Hoek.assert(refschema, 'Can not find schema reference: ' + value + '.');

    let fragment = refschema;
    const paths = path.split('/');

    for (let i = 1; i < paths.length && fragment; i++) {
      fragment = typeof fragment === 'object' && fragment[paths[i]];
    }

    return fragment;
  }

  resolveType(schema: JSONSchema, ancestors: string[]): any {
    let joischema: any;

    const typeDefinitionMap: Record<string, string> = {
      description: 'description',
      title: 'label',
      default: 'default',
    };

    const joitype = (type: string, format?: string): any => {
      let joischema: any;

      if (this.refineType) {
        type = this.refineType(type, format);
      }

      switch (type) {
        case 'array':
          joischema = this.array(schema, ancestors);
          break;
        case 'boolean':
          joischema = this.joi.boolean();
          break;
        case 'integer':
        case 'number':
          joischema = this.number(schema);
          break;
        case 'object':
          joischema = this.object(schema, ancestors);
          break;
        case 'string':
          joischema = this.string(schema);
          break;
        case 'null':
          joischema = this.joi.any().valid(null);
          break;
        default:
          joischema = this.joi.types()[type];
      }

      Hoek.assert(joischema, 'Could not resolve type: ' + schema.type + '.');

      return this.strictMode === true ? joischema.strict(true) : joischema;
    };

    if (isArray(schema.type)) {
      const schemas: any[] = [];

      for (let i = 0; i < schema.type.length; i++) {
        schemas.push(joitype(schema.type[i], schema.format));
      }

      joischema = this.joi.alternatives(schemas);
    } else {
      joischema = joitype(schema.type as string, schema.format);
    }

    Object.keys(typeDefinitionMap).forEach((key: string) => {
      if ((schema as any)[key] !== undefined) {
        joischema = joischema[typeDefinitionMap[key]]((schema as any)[key]);
      }
    });

    return joischema;
  }

  resolveOneOf(schema: JSONSchema, ancestors: string[]): any {
    Hoek.assert(isArray(schema.oneOf), 'Expected oneOf to be an array.');

    return this.joi
      .alternatives(
        schema.oneOf!.map((subSchema: any) =>
          this.resolve(subSchema, ancestors),
        ),
      )
      .match('one');
  }

  resolveAnyOf(schema: JSONSchema, ancestors: string[]): any {
    Hoek.assert(isArray(schema.anyOf), 'Expected anyOf to be an array.');

    return this.joi
      .alternatives(
        schema.anyOf!.map((subSchema: any) =>
          this.resolve(subSchema, ancestors),
        ),
      )
      .match('any');
  }

  resolveAllOf(schema: JSONSchema, ancestors: string[]): any {
    Hoek.assert(isArray(schema.allOf), 'Expected allOf to be an array.');

    return this.joi
      .alternatives(
        schema.allOf!.map((subSchema: any) =>
          this.resolve(subSchema, ancestors),
        ),
      )
      .match('all');
  }

  resolveNot(schema: JSONSchema, ancestors: string[]): any {
    Hoek.assert(isObject(schema.not), 'Expected Not to be an object.');

    return this.joi.alternatives().conditional('.', {
      not: this.resolve(schema.not, ancestors),
      then: this.joi.any(),
      otherwise: this.joi.any().forbidden(),
    });
  }

  resolveLink(schema: any): any {
    return this.joi.link().ref(`#${this.walkedSchemas.get(schema)}`);
  }

  object(schema: JSONSchema, ancestors: string[]): any {
    const resolveproperties = (): Record<string, any> | undefined => {
      const schemas: Record<string, any> = {};

      if (!isObject(schema.properties)) {
        return;
      }

      Object.keys(schema.properties).forEach((key) => {
        const property = schema.properties![key];

        let joischema = this.resolve(property, ancestors);

        if (schema.required && schema.required.indexOf(key) !== -1) {
          joischema = joischema.required();
        }

        schemas[key] = joischema;
      });

      return schemas;
    };

    let joischema = this.joi.object(resolveproperties());

    if (isObject(schema.additionalProperties)) {
      joischema = joischema.pattern(
        /^/,
        this.resolve(schema.additionalProperties, ancestors),
      );
    } else {
      joischema = joischema.unknown(schema.additionalProperties !== false);
    }

    isNumber(schema.minProperties) &&
      (joischema = joischema.min(schema.minProperties));
    isNumber(schema.maxProperties) &&
      (joischema = joischema.max(schema.maxProperties));

    return joischema;
  }

  array(schema: JSONSchema, ancestors: string[]): any {
    let joischema = this.joi.array();
    let items: any;

    const resolveAsArray = (value: any): any[] => {
      if (isArray(value)) {
        // found an array, thus its _per type_
        return value.map((v: any) => this.resolve(v, ancestors));
      }
      // it's a single entity, so just resolve it normally
      return [this.resolve(value, ancestors)];
    };

    if (schema.items) {
      items = resolveAsArray(schema.items);

      joischema = joischema.items(...items);
    } else if (schema.ordered) {
      items = resolveAsArray(schema.ordered);
      joischema = joischema.ordered(...items);
    }

    if (items && schema.additionalItems === false) {
      joischema = joischema.max(items.length);
    }

    isNumber(schema.minItems) && (joischema = joischema.min(schema.minItems));
    isNumber(schema.maxItems) && (joischema = joischema.max(schema.maxItems));

    if (schema.uniqueItems) {
      joischema = joischema.unique();
    }

    return joischema;
  }

  number(schema: JSONSchema): any {
    let joischema = this.joi.number();

    if (schema.type === 'integer') {
      joischema = joischema.integer();
    }

    isNumber(schema.minimum) && (joischema = joischema.min(schema.minimum));
    isNumber(schema.maximum) && (joischema = joischema.max(schema.maximum));
    isNumber(schema.exclusiveMinimum) &&
      (joischema = joischema.greater(schema.exclusiveMinimum));
    isNumber(schema.exclusiveMaximum) &&
      (joischema = joischema.less(schema.exclusiveMaximum));
    isNumber(schema.multipleOf) &&
      schema.multipleOf !== 0 &&
      (joischema = joischema.multiple(schema.multipleOf));

    return joischema;
  }

  string(schema: JSONSchema): any {
    let joischema = this.joi.string();

    const dateRegex = '(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])';
    const timeRegex =
      '([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60)(.[0-9]+)?(Z|(\\+|-)([01][0-9]|2[0-3]):([0-5][0-9]))';
    const dateTimeRegex = dateRegex + 'T' + timeRegex;

    if (schema.enum) {
      return this.joi.string().valid(...schema.enum);
    }

    switch (schema.format) {
      case 'date':
        return joischema.regex(
          new RegExp('^' + dateRegex + '$', 'i'),
          'JsonSchema date format',
        );
      case 'time':
        return joischema.regex(
          new RegExp('^' + timeRegex + '$', 'i'),
          'JsonSchema time format',
        );
      case 'date-time':
        return joischema.regex(
          new RegExp('^' + dateTimeRegex + '$', 'i'),
          'JsonSchema date-time format',
        );
      case 'binary':
        joischema = this.binary(schema);
        break;
      case 'email':
        return joischema.email();
      case 'hostname':
        return joischema.hostname();
      case 'ipv4':
        return joischema.ip({
          version: ['ipv4'],
        });
      case 'ipv6':
        return joischema.ip({
          version: ['ipv6'],
        });
      case 'uri':
        return joischema.uri();
      case 'byte':
        joischema = joischema.base64();
        break;
      case 'uuid':
        return joischema.guid({ version: ['uuidv4'] });
      case 'guid':
        return joischema.guid();
    }
    return this.regularString(schema, joischema);
  }

  regularString(schema: JSONSchema, joischema: any): any {
    schema.pattern && (joischema = joischema.regex(new RegExp(schema.pattern)));

    if (isUndefined(schema.minLength)) {
      schema.minLength = 0;
      if (!schema.pattern && !schema.format) {
        joischema = joischema.allow('');
      }
    } else if (schema.minLength === 0) {
      joischema = joischema.allow('');
    }
    isNumber(schema.minLength) && (joischema = joischema.min(schema.minLength));
    isNumber(schema.maxLength) && (joischema = joischema.max(schema.maxLength));
    return joischema;
  }

  binary(schema: JSONSchema): any {
    let joischema = this.joi.binary();
    isNumber(schema.minLength) && (joischema = joischema.min(schema.minLength));
    isNumber(schema.maxLength) && (joischema = joischema.max(schema.maxLength));
    return joischema;
  }
}

/**
 * Enjoi-compatible API
 * Creates a Joi schema from a JSON Schema
 * @param jsonSchema - The JSON schema to convert
 * @param options - Optional configuration for schema resolution
 * @returns Joi schema with validate method
 */
function schema(jsonSchema: any, options?: SchemaResolverOptions): any {
  const resolver = new SchemaResolver(jsonSchema, options);
  return resolver.resolve();
}

// Export both the class and the compatible API
export { SchemaResolver, schema };
export default { schema };
