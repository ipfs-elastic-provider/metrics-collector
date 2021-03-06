import { Histogram } from "../indexer-metrics-collector/prometheus.js";

/**
 * @typedef SerializedHistogram
 * @property {"histogram"} type
 * @property {string} name
 * @property {string} help
 * @property {string[]} labelNames
 * @property {number[]} buckets
 * @property {string} aggregator
 * @property {Record<string,{ labels: Record<string,string>, bucketValues: Record<string,number>, sum: number, count: number }>} hashToBuckets
 */

/**
 * Object to encode/decde a prom-client Histogram to/from an object that can be JSON-stringified.
 * One use case for this is to encode the Histogram into something that can be stored in a k/v store
 */
export class HistogramSerializer {
  /**
   * @param {Histogram<string>} metric
   * @returns {Promise<SerializedHistogram>}
   */
  static async serialize(metric) {
    const got = await metric.get();
    const labelNames = metric.labelNames;
    const buckets = metric.buckets;
    const hashToBuckets = metric.hashMap;
    const { name, help, type, aggregator } = got;
    /** @type {SerializedHistogram} */
    const serialized = {
      labelNames,
      buckets,
      name,
      help,
      type,
      aggregator,
      hashToBuckets,
    };
    return serialized;
  }

  /**
   * @param {SerializedHistogram} serialized
   * @param {Array<import('prom-client').Registry>} registers
   * @returns {Histogram<string>}
   */
  static deserialize(serialized, registers) {
    const histogram = new Histogram({
      name: serialized.name,
      help: serialized.help,
      buckets: serialized.buckets,
      registers,
    });
    histogram.hashMap = serialized.hashToBuckets;
    return histogram;
  }
}

/**
 * @param {Histogram<string>} histogram
 * @returns {number}
 */
export function countHistogramEntries(histogram) {
  let total = 0;
  for (const entry of Object.entries(histogram.hashMap)) {
    total += entry[1].count;
  }
  return total;
}
