# Oracle semantics

Desired semantic contract for Oracle. This file defines ownership and meaning, not concrete source APIs.

## OWNERSHIP

```text
Application owns
- what context is required
- why it is required
- context shape / schema
- required vs optional fields
- scope and semantic relevance
- any explicit context budget or selection constraint

Oracle owns
- where requested data physically lives
- how to retrieve it
- how source-specific data is adapted/normalized
- how to satisfy the application contract with the simplest fitting mechanism
```

The dependency direction is application -> port/contract, infrastructure -> implementation.

Oracle must not reverse that ownership by deciding that a Backend Worker "probably needs Figma", that a Frontend Worker "probably needs repository history", or that additional sources are useful outside the declared requirement.

## SINGLE-PASS RESOLUTION

Oracle is resolve-once infrastructure.

```text
ContextRequirement
       |
       v
   Oracle.resolve(...)
       |
       v
validated Context
       |
       v
Worker execution
```

There is no implicit refresh during Worker execution. If the application wants a new context snapshot, it performs another explicit resolution.

This deliberately excludes provider lifecycle concepts such as `before_run`, `after_run`, long-lived session state or automatic turn-by-turn context injection.

## CONTRACT SEMANTICS

Application context contracts must be explicit and runtime-validatable. The first implementation should use Zod-compatible schemas rather than a custom schema system.

Exact role schemas are intentionally not fixed here. Backend, frontend, QA and design workers may require different contracts, and those contracts belong to the Agentic Application Layer rather than Oracle.

Illustrative only:

```text
Backend context may request source/spec/API material.
Frontend context may request design/API/source material.
Design context may request product/design-system/Figma material.
QA context may request acceptance/spec/build/test material.
```

These examples do not define canonical fields.

## RESOLUTION SEMANTICS

A resolver satisfies a declared requirement. It may search, filter, parse or transform source data as needed, but it must not broaden the semantic requirement on its own.

The default implementation rule is:

```text
direct access
    > source-specific adapter
        > specialized retrieval framework
```

Examples:

- known file/path -> direct file read;
- known OpenAPI location -> direct structured parse;
- source with a useful existing MCP server -> MCP client may be used;
- large corpus with unknown relevant subset -> semantic retrieval/RAG may be used;
- a simple source must not be forced through MCP, embeddings or a vector store solely for architectural uniformity.

## FAILURE SEMANTICS

Oracle must not fabricate missing context to satisfy a schema.

Required/optional semantics come from the application-owned contract. If required context cannot be resolved or validated, resolution fails explicitly. Optional data may remain absent only when the application contract permits it.

## AUTHORITY

A resolved context object is an adapted input for Worker execution. It is not a new source of truth and does not replace the authority of the underlying source systems.
