// Backwards-compatibility re-export for external SDK consumers that deep-imported
// `build/shared/utils/enjoi-resolver.js` while joi+enjoi were the runtime backend.
// The implementation now lives in `./schema-validator.ts` (ajv-backed).
import { CompiledSchema, compileSchema } from './schema-validator.js';

class SchemaResolver {
  static schema = compileSchema;
}

export { CompiledSchema, SchemaResolver, compileSchema as schema };
export default { SchemaResolver, schema: compileSchema };
