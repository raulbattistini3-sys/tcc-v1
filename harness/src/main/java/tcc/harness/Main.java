package tcc.harness;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.PlaywrightException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Entry point. Run from harness/ with the wrapper:
 *
 * <pre>
 *   ./mvnw -q compile exec:java -Dexec.args="--apps react,angular --strategies main,worker --samples 5"
 * </pre>
 *
 * Writes results/&lt;runId&gt;/queries.csv (one row per measured query), run.json
 * (machine, browser, commit, arguments) and, with --trace, one Chrome trace per sample.
 */
public final class Main {
  public static void main(String[] args) throws Exception {
    Config cfg = Config.parse(args);
    // exec:java runs in Maven's JVM, from harness/ or the repo root: find the root either way.
    Path repo = Path.of("").toAbsolutePath();
    if (!Files.exists(repo.resolve("tools/serve.mjs"))) repo = repo.getParent();
    if (repo == null || !Files.exists(repo.resolve("tools/serve.mjs"))) throw new IllegalStateException("can't find the repo root (tools/serve.mjs)");
    String initScript = resource("/harness-init.js");

    // A locally installed Chrome by default: no browser download, and the browser users actually run.
    var env = cfg.channel().equals("chromium") ? Map.<String, String>of() : Map.of("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1");
    try (DevServer server = cfg.baseUrl() == null ? DevServer.start(repo, cfg.port(), cfg.csp()) : null;
        Playwright pw = Playwright.create(new Playwright.CreateOptions().setEnv(env))) {
      var launch = new BrowserType.LaunchOptions().setHeadless(!cfg.headed());
      if (!cfg.channel().equals("chromium")) launch.setChannel(cfg.channel());
      Browser browser = pw.chromium().launch(launch);

      RunInfo info = RunInfo.collect(repo, browser.version());
      Path out = repo.resolve(cfg.out()).resolve(info.runId());
      Files.createDirectories(out);
      Files.writeString(out.resolve("run.json"),
          "{\"info\":" + info.json() + ",\"csp\":\"" + cfg.csp() + "\",\"args\":\"" + String.join(" ", args).replace("\"", "'") + "\"}\n");
      System.out.printf("run %s  commit %s  %s  %d cores%n", info.runId(), info.commit(), info.browser(), info.cores());

      int total = cfg.apps().size() * cfg.conds().size() * cfg.strategies().size() * cfg.matches().size() * cfg.data().size() * cfg.throttles().size() * cfg.samples();
      int done = 0;
      try (CsvSink csv = new CsvSink(out.resolve("queries.csv"))) {
        for (String app : cfg.apps())
          for (String cond : cfg.conds())
            for (String strategy : cfg.strategies())
              for (String match : cfg.matches())
                for (String data : cfg.data())
                  for (int throttle : cfg.throttles())
                    for (int sample = 1; sample <= cfg.samples(); sample++) {
                      var key = new Key(app, cond, strategy, match, data, throttle, sample);
                      long t0 = System.nanoTime();
                      try {
                        var rows = sample(browser, cfg, initScript, info, out, key);
                        csv.write(rows);
                        System.out.printf("[%d/%d] %s  %d rows  %.1fs%n", ++done, total, key, rows.size(), (System.nanoTime() - t0) / 1e9);
                      } catch (PlaywrightException e) {
                        // One failed sample (timeout, crash) shouldn't lose the run; it is logged and skipped.
                        System.out.printf("[%d/%d] %s  FAILED: %s%n", ++done, total, key, e.getMessage().lines().findFirst().orElse(""));
                        Files.writeString(out.resolve("errors.log"), key + "\n" + e + "\n\n", StandardCharsets.UTF_8,
                            java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
                      }
                    }
      }
      browser.close();
      System.out.println("wrote " + out.resolve("queries.csv"));
    }
  }

  record Key(String app, String cond, String strategy, String match, String data, int throttle, int sample) {
    String url(String base, int seed) {
      return base + "/" + app + "/?cond=" + cond + "&strategy=" + strategy + "&match=" + match
          + "&data=" + URLEncoder.encode(data, StandardCharsets.UTF_8) + "&seed=" + seed;
    }

    @Override
    public String toString() {
      return app + " " + cond + " " + strategy + " " + match + " " + data + " x" + throttle + " #" + sample;
    }
  }

  /** One cold load, then every pass of every step on it. */
  private static List<Map<String, Object>> sample(Browser browser, Config cfg, String initScript, RunInfo info, Path out, Key k) throws IOException {
    Path trace = cfg.trace() ? out.resolve("traces").resolve(String.join("_", k.app, k.cond, k.strategy, k.match, String.valueOf(k.throttle), String.valueOf(k.sample)) + ".json") : null;
    if (trace != null) Files.createDirectories(trace.getParent());
    List<Map<String, Object>> rows = new ArrayList<>();
    String workerError;
    try (ShopPage shop = ShopPage.open(browser, cfg, initScript, k.throttle, k.url(cfg.url(), 7), trace)) {
      workerError = shop.workerError();
      shop.prepare(k.cond);
      for (int pass = 1; pass <= cfg.passes(); pass++) {
        if (pass > 1) shop.reset();
        for (Step step : Step.forCond(k.cond)) {
          var row = shop.run(step);
          row.put("runId", info.runId());
          row.put("commit", info.commit());
          row.put("browser", info.browser());
          row.put("app", k.app);
          row.put("cond", k.cond);
          row.put("strategy", k.strategy);
          row.put("match", k.match);
          row.put("data", k.data);
          row.put("throttle", k.throttle);
          row.put("sample", k.sample);
          row.put("pass", pass);
          row.put("state", cfg.stateOf(pass));
          row.put("step", step.id);
          row.put("workerError", workerError);
          rows.add(row);
        }
      }
    }
    // The trace file is complete only after stopTracing (in close()).
    if (trace != null) {
      var gc = TraceGc.perQuery(trace);
      for (var row : rows) {
        var g = gc.get(((Number) row.get("queryId")).intValue());
        if (g == null) continue;
        row.put("gcMainMs", g.mainMs());
        row.put("gcMainCount", g.mainCount());
        row.put("gcWorkerMs", g.workerMs());
        row.put("gcWorkerCount", g.workerCount());
      }
    }
    return rows;
  }

  private static String resource(String name) throws IOException {
    try (InputStream in = Main.class.getResourceAsStream(name)) {
      if (in == null) throw new IOException("missing resource " + name);
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }
}
