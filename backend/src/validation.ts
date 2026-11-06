// Valideert request bodies tegen de schema's in api.yaml.
// api.yaml is daarmee echt het contract: wat daar niet mag, mag de backend ook niet.
import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import type { ErrorObject, ValidateFunction } from 'ajv'
import { parse } from 'yaml'
import { badRequest } from './http.ts'

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020

type Json = Record<string, unknown>

const specPath = new URL('../api.yaml', import.meta.url)
// eslint-disable-next-line security/detect-non-literal-fs-filename -- vast pad naar api.yaml
export const spec = parse(readFileSync(specPath, 'utf8')) as Json

/** Zet OpenAPI-refs om naar refs binnen het "api"-schema. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs)
  if (node && typeof node === 'object') {
    const out: Json = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        out[key] = value.replace('#/components/schemas/', 'api#/$defs/')
      } else if (!key.startsWith('x-') && key !== 'example') {
        out[key] = rewriteRefs(value)
      }
    }
    return out
  }
  return node
}

const ajv = new Ajv2020({ strict: false, allErrors: false })
addFormats(ajv)

const components = spec.components as { schemas: Json }
ajv.addSchema({ $id: 'api', $defs: rewriteRefs(components.schemas) })

interface Operation {
  requestBody?: { required?: boolean; content?: { 'application/json'?: { schema?: unknown } } } | { $ref: string }
}

const validators = new Map<string, { validate: ValidateFunction; required: boolean }>()
const operationIds = new Set<string>()

for (const item of Object.values(spec.paths as Record<string, Record<string, Operation & { operationId?: string }>>)) {
  for (const op of Object.values(item)) {
    if (!op || typeof op !== 'object' || !op.operationId) continue
    operationIds.add(op.operationId)
    const body = op.requestBody as { required?: boolean; content?: { 'application/json'?: { schema?: unknown } } } | undefined
    const schema = body?.content?.['application/json']?.schema
    if (!schema) continue
    validators.set(op.operationId, {
      validate: ajv.compile(rewriteRefs(schema) as Json),
      required: body?.required ?? false,
    })
  }
}

export function knownOperation(operationId: string): boolean {
  return operationIds.has(operationId)
}

function describe(error: ErrorObject | undefined): string {
  if (!error) return 'Ongeldige invoer.'
  const field = error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'body'
  switch (error.keyword) {
    case 'required':
      return `Het veld "${String(error.params.missingProperty)}" ontbreekt.`
    case 'additionalProperties':
      return `Onbekend veld "${String(error.params.additionalProperty)}".`
    case 'maxLength':
      return `Het veld "${field}" is te lang.`
    case 'minLength':
      return `Het veld "${field}" is te kort.`
    case 'enum':
      return `Het veld "${field}" heeft een ongeldige waarde.`
    default:
      return `Het veld "${field}" is ongeldig.`
  }
}

/** Gooit 400 als de body niet aan api.yaml voldoet. */
export function validateBody(operationId: string, body: unknown): void {
  const entry = validators.get(operationId)
  if (!entry) {
    if (body !== undefined) throw badRequest('Dit verzoek heeft geen body.')
    return
  }
  if (body === undefined) {
    if (entry.required) throw badRequest('Request body ontbreekt.')
    return
  }
  if (!entry.validate(body)) throw badRequest(describe(entry.validate.errors?.[0]))
}
