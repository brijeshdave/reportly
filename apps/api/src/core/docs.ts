// Author: Brijesh Dave <https://github.com/brijeshdave>
// OpenAPI documentation. Sets the Zod validator/serializer compilers (so route
// Zod schemas double as runtime validation) and serves an auto-generated OpenAPI
// spec + Swagger UI. Register BEFORE feature routes so they are captured.
// The auth endpoints are merged in from better-auth, so /api/v1/docs is the whole
// API in one place.
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { AUTH_BASE_PATH, getAuth } from "@/core/auth/auth.js";

// Kept local to avoid importing the app module (cycle); mirror of API_PREFIX.
const DOCS_PREFIX = "/api/v1/docs";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fold better-auth's endpoints into our spec. It documents itself with paths
 * relative to its base path, so each is re-keyed absolute. Its own reference page
 * is disabled (see `openAPI()` in core/auth/auth.ts): that page loads Scalar from
 * a CDN, which our Content-Security-Policy blocks — correctly — leaving it blank.
 */
function mergeAuthSpec(openapiObject: any, authSpec: any): any {
  const target = openapiObject;
  target.paths ??= {};

  for (const [path, item] of Object.entries(authSpec.paths ?? {})) {
    target.paths[`${AUTH_BASE_PATH}${path}`] = item;
  }

  // Never clobber one of ours: a name collision would silently redefine our schema.
  target.components ??= {};
  target.components.schemas ??= {};
  for (const [name, schema] of Object.entries(authSpec.components?.schemas ?? {})) {
    target.components.schemas[name] ??= schema;
  }

  return target;
}

export async function registerDocs(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Describes the endpoint surface, not the data, so it needs no database.
  const authSpec = await getAuth().api.generateOpenAPISchema();

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Reportly API",
        version: "0.1.0",
        description:
          "Reportly HTTP API, including the auth, SSO and 2FA endpoints. Most endpoints require a session cookie and an X-Company-Id header.",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        },
      },
    },
    transform: jsonSchemaTransform,
    // The document is a union of the swagger-2 and openapi-3 shapes; we configure
    // `openapi`, so it is always the latter.
    transformObject: (document) =>
      "openapiObject" in document
        ? mergeAuthSpec(document.openapiObject, authSpec)
        : document.swaggerObject,
  });

  await app.register(fastifySwaggerUi, { routePrefix: DOCS_PREFIX });
}
