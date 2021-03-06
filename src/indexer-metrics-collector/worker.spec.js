import test from "ava";
import { Miniflare } from "miniflare";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { basicAuthHeaderValue } from "./basic-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const examplePrometheusLabels = {
  object: { a: "A", b: "B" },
  pattern: /a="A",b="B"/g,
  env: {
    PROMETHEUS_DEFAULT_LABELS: JSON.stringify({ a: "A", b: "B" }),
  },
};

/** @type {import("./indexer-metrics-collector.mjs").ClientsPolicy} */
const exampleClientsPolicy = {
  userA: {
    passwords: ["a"],
    capabilities: ["postEvent", "getMetrics"],
  },
};
const exampleClients = {
  clients: exampleClientsPolicy,
  env: {
    CLIENTS: JSON.stringify(exampleClientsPolicy),
  },
};

/**
 *
 * @param {Record<string,string>} [env]
 */
function useMiniflare(env = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: join(
      __dirname,
      "../../dist/indexer-metrics-collector/worker.js"
    ),
    packagePath: true,
    wranglerConfigPath: join(__dirname, "wrangler.toml"),
    bindings: {
      ...env,
    },
    buildCommand:
      "npx wrangler publish src/indexer-metrics-collector/worker.mjs --dry-run --outdir=dist/indexer-metrics-collector",
  });
}

test("can test indexer-metrics-collector with miniflare", async (t) => {
  // Get the Miniflare instance
  const mf = useMiniflare();
  // Dispatch a fetch event to our worker
  const res = await mf.dispatchFetch("http://localhost:8787");
  // Check the count is "1" as this is the first time we've been to this path
  t.is(await res.text(), "indexer-metrics-collector");

  // test sending an event
  const eventSubmissionResponse = await mf.dispatchFetch(
    "http://localhost:8787"
  );
  t.is(eventSubmissionResponse.status, 200);
});

test("makes use of PROMETHEUS_DEFAULT_LABELS env var", async (t) => {
  const mf = useMiniflare({
    ...examplePrometheusLabels.env,
    ...exampleClients.env,
  });
  const metricsResponse = await mf.dispatchFetch(
    "http://localhost:8787/metrics",
    {
      headers: {
        authorization: basicAuthHeaderValue(
          "userA",
          exampleClients.clients.userA.passwords[0]
        ),
      },
    }
  );
  t.is(metricsResponse.status, 200);
  const metricsText = await metricsResponse.text();
  t.is(
    metricsText.match(examplePrometheusLabels.pattern)?.length,
    // This will be 28 unless we change the bucketing or add metrics
    28
  );
});
