---
'@latticecms/store-mongo': minor
---

Each MongoStore call is an OpenTelemetry client span, `{operation} {collection}`, with `db.system.name`, `db.namespace`, `db.operation.name` and `db.collection.name`, a child of the active span; a transaction is one parent span. A failure sets ERROR and `error.type`, with no exception event and no query text, so no document value reaches a span. `@opentelemetry/api` (`^1.3.0`) is a new peer dependency.
