# API Weather

How often do popular public APIs break their clients? API Weather reads the git history of each vendor's published OpenAPI spec, diffs it month by month with [oasdiff](https://github.com/oasdiff/oasdiff), and turns the result into a stability score and a few headlines.

> Work in progress. The data pipeline is done. The daily GitHub Action and the site come next.

## Run the pipeline

You need Node 22+ and [oasdiff](https://github.com/oasdiff/oasdiff#installation) 1.33+ on your `PATH` (or set `OASDIFF=/path/to/oasdiff`).

```sh
cd pipeline
npm install
npm run build              # all APIs; first run backfills the full history
ONLY=stripe npm run build  # one API
```

Spec repos are cloned blobless into `.cache/repos/`. Results land in [`data/`](data/), where the data format and the methodology are written up.

## APIs tracked

The registry is in [`apis.json`](apis.json). It covers Stripe, GitHub, OpenAI, Twilio, Cloudflare, Discord, PagerDuty, Plaid, Asana and Box. Each entry is one spec file in the vendor's own GitHub repo.

## License

MIT
