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

Source available under the included Ainotation Development and Non-Commercial
License. Internal development and debugging, including for commercial projects,
are free. Commercial distribution, hosted services and production integration of
Ainotation require separate written authorization. See LICENSE for complete terms.
