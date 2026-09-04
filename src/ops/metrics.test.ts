import { describe, it, expect } from "vitest";
import { incCounter, observeLatency, percentile, renderPrometheus, setGauge } from "./metrics.js";

describe("metrics", () => {
  it("counters accumulate and render prometheus format", () => {
    incCounter("wb_test_total");
    incCounter("wb_test_total");
    const out = renderPrometheus();
    expect(out).toContain("wb_test_total 2");
    expect(out).toContain("# TYPE wb_test_total counter");
  });

  it("latency histogram computes p95", () => {
    for (let i = 1; i <= 100; i++) observeLatency("wb_lat", i); // 1..100ms
    expect(percentile("wb_lat", 95)).toBeGreaterThanOrEqual(95);
    expect(percentile("wb_lat", 95)).toBeLessThanOrEqual(96);   // floor(0.95*100)=索引95→值96
    const out = renderPrometheus();
    expect(out).toMatch(/wb_lat\{quantile="0\.95"\} (95|96)/);
    expect(out).toContain("wb_lat_count 100");
  });

  it("gauges call getters at render time", () => {
    let v = 42;
    setGauge("wb_dyn", () => v);
    expect(renderPrometheus()).toContain("wb_dyn 42");
    v = 99;
    expect(renderPrometheus()).toContain("wb_dyn 99");
  });
});
