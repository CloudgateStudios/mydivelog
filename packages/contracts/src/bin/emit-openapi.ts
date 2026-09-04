import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../openapi.ts';

const [, , out = 'openapi.json'] = process.argv;
const doc = buildOpenApiDocument(process.env['APP_VERSION'] ?? '0.0.0');
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}: ${Object.keys(doc.paths).length} paths`);
