package tcc.harness;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Run matrix and knobs. Every list flag is comma-separated; the harness runs the
 * cartesian product of apps × conds × strategies × matches × data × throttles,
 * {@code samples} cold page loads each, with {@code warmup + warm} more passes per load.
 *
 * <pre>
 *   --apps react,angular,angular-zone   --conds empty,logged,full
 *   --strategies adaptive,main,worker   --matches contains,token,prefix
 *   --data /data/produtos.bin           --throttle 1,4
 *   --samples 5 --warmup 3 --warm 5     --search mouse --category 6
 *   --trace                             GC per thread from Chrome traces (slower, large files)
 *   --port 5180 --csp strict            the harness starts tools/serve.mjs itself
 *   --base-url http://host:port         use a server already running instead
 *   --channel chrome|chromium|msedge    --headed
 *   --out results
 * </pre>
 */
public record Config(
    List<String> apps,
    List<String> conds,
    List<String> strategies,
    List<String> matches,
    List<String> data,
    List<Integer> throttles,
    int samples,
    int warmup,
    int warm,
    String search,
    int category,
    boolean trace,
    int port,
    String csp,
    String baseUrl,
    String channel,
    boolean headed,
    Path out,
    long stepTimeoutMs,
    int probeDelayMs) {

  /** Shops' search debounce (apps/shared/catalog.js SEARCH_DEBOUNCE_MS). */
  public static final int SEARCH_DEBOUNCE_MS = 250;

  public static Config parse(String[] args) {
    var a = new Args(args);
    var c =
        new Config(
            a.list("--apps", "react,angular"),
            a.list("--conds", "logged"),
            a.list("--strategies", "adaptive,main,worker"),
            a.list("--matches", "contains"),
            a.list("--data", "/data/produtos.bin"),
            a.list("--throttle", "1").stream().map(Integer::parseInt).toList(),
            a.integer("--samples", 3),
            a.integer("--warmup", 2),
            a.integer("--warm", 3),
            a.string("--search", "mouse"),
            a.integer("--category", 6),
            a.flag("--trace"),
            a.integer("--port", 5180),
            a.string("--csp", "strict"),
            a.string("--base-url", null),
            a.string("--channel", "chrome"),
            a.flag("--headed"),
            Path.of(a.string("--out", "results")),
            a.integer("--step-timeout", 180) * 1000L,
            a.integer("--probe-delay", 30));
    a.rejectUnknown();
    return c;
  }

  public String url() {
    return baseUrl != null ? baseUrl : "http://localhost:" + port;
  }

  public int passes() {
    return 1 + warmup + warm;
  }

  /** cold = first pass after a fresh context, warming = JIT tiers still moving, warm = steady state. */
  public String stateOf(int pass) {
    return pass == 1 ? "cold" : pass <= 1 + warmup ? "warming" : "warm";
  }

  private static final class Args {
    private final List<String> rest;

    Args(String[] args) {
      rest = new ArrayList<>(Arrays.asList(args));
    }

    String string(String name, String fallback) {
      int i = rest.indexOf(name);
      if (i < 0) return fallback;
      if (i + 1 >= rest.size()) throw new IllegalArgumentException(name + " needs a value");
      String v = rest.get(i + 1);
      rest.subList(i, i + 2).clear();
      return v;
    }

    List<String> list(String name, String fallback) {
      return Arrays.stream(string(name, fallback).split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    int integer(String name, int fallback) {
      String v = string(name, null);
      return v == null ? fallback : Integer.parseInt(v);
    }

    boolean flag(String name) {
      return rest.remove(name);
    }

    void rejectUnknown() {
      if (!rest.isEmpty()) throw new IllegalArgumentException("unknown arguments: " + rest);
    }
  }
}
