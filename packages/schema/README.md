# @ainotation/schema

Shared Zod contracts, JSON Schema and Markdown/JSON handoff for Ainotation
annotations and image metadata. Image bytes are transferred separately.

```sh
pnpm add @ainotation/schema@beta
```

```ts
import { FeedbackExportSchema, feedbackExportJsonSchema } from '@ainotation/schema';

const schema = feedbackExportJsonSchema();
const feedback = FeedbackExportSchema.parse(input);
```

See the [project documentation](https://github.com/nightire/ainotation#readme) for
the feedback model and integration options.

UI Variants adds an optional annotation-level exploration with immutable target IDs,
bounded candidates, generation/revision checks, explicit user decisions and separate
browser reports. Its dedicated operations preserve exploration progress during
ordinary annotation edits. Markdown, JSON and MCP retain the exploration while the
ordinary internal conversation fields remain excluded from public exports.

Deleting an unfinished exploration moves its original comment/page/targets and
cancelled exploration into `variantCleanups`, with the former annotation ID,
deletion time and `annotation-deleted` reason. The record excludes marker placement,
attachments and ordinary conversation history. Pending entries appear in every
Markdown detail level and in JSON/MCP, survive further annotation deletes and
cannot be resurrected by stale upserts. Completion uses the existing variants
operation and releases ownership while retaining a completed receipt.

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
