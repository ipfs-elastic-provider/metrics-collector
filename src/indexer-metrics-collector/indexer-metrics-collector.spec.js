import { test } from "../testing.js";
import { IndexerMetricsCollector } from "./indexer-metrics-collector.mjs";
import {
  IndexerCompleted,
  IndexerNotified,
} from "../indexer-events/indexer-events.js";
import { Request } from "@web-std/fetch";
import { generate } from "../schema.js";
import parsePrometheus from "parse-prometheus-text-format";
import assert from "node:assert";
import { DurableObjectStorage } from "@miniflare/durable-objects";
import { MemoryStorage } from "@miniflare/storage-memory";
import { basicAuthHeaderValue } from "./basic-auth.js";

const exampleImageUri =
  "https://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy.ipfs.nftstorage.link/";

/** @type {import("./indexer-metrics-collector.mjs").ClientsPolicy} */
const exampleClientsPolicy = {
  eventPoster: {
    passwords: ["foo"],
    capabilities: ["postEvent"],
  },
  metricsScraper: {
    passwords: ["bar"],
    capabilities: ["getMetrics"],
  },
};

test("POST /events responds with 401 when no authorization in request", async (t) => {
  const collector = new IndexerMetricsCollector({
    storage: new DurableObjectStorage(new MemoryStorage()),
  });
  const eventSubmissionResponse = await collector.fetch(
    new Request("https://example.com/events", {
      method: "post",
      body: JSON.stringify(generate(IndexerCompleted.schema)),
    })
  );
  t.is(eventSubmissionResponse.status, 401);
});

test("GET /metrics responds with 401 when no authorization in request", async (t) => {
  const collector = new IndexerMetricsCollector({
    storage: new DurableObjectStorage(new MemoryStorage()),
  });
  const eventSubmissionResponse = await collector.fetch(
    new Request("https://example.com/metrics", {
      method: "get",
    })
  );
  t.is(eventSubmissionResponse.status, 401);
});

test("GET /metrics responds with 403 when authorization is provided without getMetrics capability", async (t) => {
  const collector = new IndexerMetricsCollector({
    storage: new DurableObjectStorage(new MemoryStorage()),
  });
  const eventSubmissionResponse = await collector.fetch(
    new Request("https://example.com/metrics", {
      method: "get",
      headers: {
        authorization: basicAuthHeaderValue(
          "eventPoster",
          exampleClientsPolicy.eventPoster.passwords[0]
        ),
      },
    })
  );
  t.is(eventSubmissionResponse.status, 403);
});

test("can send IndexerCompleted event to IndexerMetricsCollector", async (t) => {
  const storage = new DurableObjectStorage(new MemoryStorage());
  const collector = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const event1 = generate(IndexerCompleted.schema);
  // submit an event
  const eventSubmissionRequest = new Request("https://example.com/events", {
    method: "post",
    body: JSON.stringify(event1),
    headers: {
      authorization: basicAuthHeaderValue(
        "eventPoster",
        exampleClientsPolicy.eventPoster.passwords[0]
      ),
      "content-type": "application/json",
    },
  });
  const eventSubmissionResponse = await collector.fetch(eventSubmissionRequest);
  t.is(eventSubmissionResponse.status, 202);
});

test("can provide defaultPrometheusLabels to IndexerMetricsCollector constructor", async (t) => {
  const defaultPrometheusLabels = { a: "A", b: "B" };
  const labelsPromTextPattern = /a="A",b="B"/g;
  const storage = new DurableObjectStorage(new MemoryStorage());
  const collector = new IndexerMetricsCollector(
    {
      storage,
    },
    undefined,
    exampleClientsPolicy,
    undefined,
    undefined,
    defaultPrometheusLabels
  );
  await postSampleEvents(
    collector,
    basicAuthHeaderValue(
      "eventPoster",
      exampleClientsPolicy.eventPoster.passwords[0]
    ),
    t
  );
  const metricsText = await fetchMetrics(
    collector,
    basicAuthHeaderValue(
      "metricsScraper",
      exampleClientsPolicy.metricsScraper.passwords[0]
    ),
    t
  );
  // parsePrometheus wont actually show the labels even if they're there.
  // so we'll assert they're in there via regex on the unparsed prometheus-text-format string
  t.is(
    metricsText.match(labelsPromTextPattern)?.length,
    // This will be 28 unless we change the bucketing or add metrics
    28
  );

  // we also want to make sure that these labels are specific to the collector.
  // i.e. another collector made from same storage should not have the same labels in its metrics
  const collector2 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const metricsText2 = await fetchMetrics(
    collector2,
    basicAuthHeaderValue(
      "metricsScraper",
      exampleClientsPolicy.metricsScraper.passwords[0]
    ),
    t
  );
  t.is(metricsText2.match(labelsPromTextPattern), null);
});

/**
 * Send at least one event to IndexerMetricsCollector
 * @param {IndexerMetricsCollector} collector
 * @param {string} authorization - http authorization header value
 * @param {import("ava").ExecutionContext<unknown>} t
 */
async function postSampleEvents(collector, authorization, t) {
  const event1 = generate(IndexerNotified.schema);

  // submit an event
  const eventSubmissionRequest = new Request("https://example.com/events", {
    method: "post",
    body: JSON.stringify(event1),
    headers: {
      "content-type": "application/json",
      authorization,
    },
  });
  const eventSubmissionResponse = await collector.fetch(eventSubmissionRequest);
  t.is(eventSubmissionResponse.status, 202);
}

/**
 * Fetch prometheus metrics, parse, and return the result
 * @param {IndexerMetricsCollector} collector
 * @param {string} authorization - http authorization header value
 * @param {import("ava").ExecutionContext<unknown>} t
 */
async function fetchMetrics(collector, authorization, t) {
  const metricsResponse = await collector.fetch(
    new Request("https://example.com/metrics", {
      headers: {
        authorization,
      },
    })
  );
  t.is(metricsResponse.status, 200);
  const metricsResponseText = await metricsResponse.text();
  t.assert(
    metricsResponseText.toLowerCase().includes("histogram"),
    "expected metrics response text to contain histogram"
  );
  return metricsResponseText;
}

test("can send IndexerNotified events to IndexerMetricsCollector and then request file_size_bytes metrics", async (t) => {
  const storage = new DurableObjectStorage(new MemoryStorage());
  const collector = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const event1 = generate(IndexerNotified.schema);
  // submit an event
  const eventSubmissionRequest = new Request("https://example.com/events", {
    method: "post",
    body: JSON.stringify(event1),
    headers: {
      "content-type": "application/json",
      authorization: basicAuthHeaderValue(
        "eventPoster",
        exampleClientsPolicy.eventPoster.passwords[0]
      ),
    },
  });
  const eventSubmissionResponse = await collector.fetch(eventSubmissionRequest);
  t.is(eventSubmissionResponse.status, 202);
  // fetch metrics
  const metricsResponseText = await fetchMetrics(
    collector,
    basicAuthHeaderValue(
      "metricsScraper",
      exampleClientsPolicy.metricsScraper.passwords[0]
    ),
    t
  );
  t.assert(
    metricsResponseText.toLowerCase().includes("histogram"),
    "expected metrics response text to contain histogram"
  );
  const parsedMetrics = parsePrometheus(metricsResponseText);
  const ipfsIndexerNotified = parsedMetrics.find(
    (m) => m.name === "file_size_bytes"
  );
  t.assert(ipfsIndexerNotified);
  assert.ok(ipfsIndexerNotified?.type === "HISTOGRAM");
  t.is(ipfsIndexerNotified?.metrics.length, 1);
  t.is(ipfsIndexerNotified?.metrics[0].count, "1");
});

test("can send multiple IndexerNotified events to multiple IndexerMetricsCollector and then request file_size_bytes metrics", async (t) => {
  const storage = new DurableObjectStorage(new MemoryStorage());
  const collector1 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  // submit an event1
  const eventSubmissionResponse1 = await collector1.fetch(
    new Request("https://example.com/events", {
      method: "post",
      body: JSON.stringify(generate(IndexerNotified.schema)),
      headers: {
        "content-type": "application/json",
        authorization: basicAuthHeaderValue(
          "eventPoster",
          exampleClientsPolicy.eventPoster.passwords[0]
        ),
      },
    })
  );
  t.is(eventSubmissionResponse1.status, 202);

  // submit an event2
  const collector2 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const eventSubmissionResponse2 = await collector2.fetch(
    new Request("https://example.com/events", {
      method: "post",
      body: JSON.stringify(generate(IndexerNotified.schema)),
      headers: {
        "content-type": "application/json",
        authorization: basicAuthHeaderValue(
          "eventPoster",
          exampleClientsPolicy.eventPoster.passwords[0]
        ),
      },
    })
  );
  t.is(eventSubmissionResponse2.status, 202);

  // fetch metrics
  const collector3 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const metricsResponseText = await fetchMetrics(
    collector3,
    basicAuthHeaderValue(
      "metricsScraper",
      exampleClientsPolicy.metricsScraper.passwords[0]
    ),
    t
  );
  t.assert(
    metricsResponseText.toLowerCase().includes("histogram"),
    "expected metrics response text to contain histogram"
  );
  const parsedMetrics = parsePrometheus(metricsResponseText);
  const ipfsIndexerNotified = parsedMetrics.find(
    (m) => m.name === "file_size_bytes"
  );
  t.assert(ipfsIndexerNotified);
  assert.ok(ipfsIndexerNotified?.type === "HISTOGRAM");
  t.is(ipfsIndexerNotified?.metrics.length, 1);
  t.is(ipfsIndexerNotified?.metrics[0].count, "2");
});

test("can send multiple IndexerCompleted events to multiple IndexerMetricsCollector and then request indexing_duration_seconds metrics", async (t) => {
  const storage = new DurableObjectStorage(new MemoryStorage());
  const collector1 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const now = new Date();
  const oneMinuteFromNow = new Date(Number(now) + 60 * 1000);
  /** @type {IndexerCompleted} */
  const indexerCompletedEvent = new IndexerCompleted(exampleImageUri, 1e6, {
    startTime: now,
    endTime: oneMinuteFromNow,
  });
  // submit an event1
  const eventSubmissionResponse1 = await collector1.fetch(
    new Request("https://example.com/events", {
      method: "post",
      body: JSON.stringify(indexerCompletedEvent),
      headers: {
        "content-type": "application/json",
        authorization: basicAuthHeaderValue(
          "eventPoster",
          exampleClientsPolicy.eventPoster.passwords[0]
        ),
      },
    })
  );
  t.is(eventSubmissionResponse1.status, 202);

  // fetch metrics
  const collector2 = new IndexerMetricsCollector(
    { storage },
    undefined,
    exampleClientsPolicy
  );
  const metricsResponseText = await fetchMetrics(
    collector2,
    basicAuthHeaderValue(
      "metricsScraper",
      exampleClientsPolicy.metricsScraper.passwords[0]
    ),
    t
  );
  t.assert(
    metricsResponseText.toLowerCase().includes("histogram"),
    "expected metrics response text to contain histogram"
  );
  const parsedMetrics = parsePrometheus(metricsResponseText);
  const indexingDuration = parsedMetrics.find(
    (m) => m.name === "indexing_duration_seconds"
  );
  t.assert(indexingDuration);
  assert.ok(indexingDuration?.type === "HISTOGRAM");
  t.is(indexingDuration?.metrics.length, 1);
  t.is(indexingDuration?.metrics[0].count, "1");
});
