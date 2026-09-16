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

## License

MIT licensed, free for personal and commercial use, including modification,
redistribution, hosted services and proprietary integration. Retain the copyright
and license notices. See LICENSE for complete terms.
