package tcc.harness;

import com.google.gson.JsonObject;
import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.CDPSession;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.BoundingBox;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One cold page load: a fresh browser context (own cache, storage and renderer),
 * the shop at a given URL, a CDP session for throttling and metrics, and
 * optionally a Chrome trace for GC.
 */
public final class ShopPage implements AutoCloseable {
  private static final String PROBE = "[data-testid=harness-probe]";

  private final Browser browser;
  private final BrowserContext context;
  private final Page page;
  private final CDPSession cdp;
  private final Config cfg;
  private final boolean tracing;
  private double probeX;
  private double probeY;

  private ShopPage(Browser browser, Config cfg, String initScript, int throttle, Path trace) {
    this.browser = browser;
    this.cfg = cfg;
    this.context = browser.newContext(new Browser.NewContextOptions().setViewportSize(1400, 1000));
    this.context.addInitScript(initScript);
    this.page = context.newPage();
    this.page.setDefaultTimeout(cfg.stepTimeoutMs());
    this.cdp = context.newCDPSession(page);
    cdp.send("Performance.enable");
    if (throttle > 1) {
      var p = new JsonObject();
      p.addProperty("rate", throttle);
      cdp.send("Emulation.setCPUThrottlingRate", p);
    }
    this.tracing = trace != null;
    if (tracing) {
      browser.startTracing(page, new Browser.StartTracingOptions()
          .setPath(trace)
          // devtools.timeline has MinorGC/MajorGC per thread; blink.user_timing has the shop:query marks.
          .setCategories(List.of("devtools.timeline", "v8", "blink.user_timing", "disabled-by-default-devtools.timeline")));
    }
  }

  public static ShopPage open(Browser browser, Config cfg, String initScript, int throttle, String url, Path trace) {
    var shop = new ShopPage(browser, cfg, initScript, throttle, trace);
    shop.page.navigate(url);
    shop.page.waitForFunction("() => window.__shop && window.__shop.ready", null,
        new Page.WaitForFunctionOptions().setPollingInterval(50).setTimeout(cfg.stepTimeoutMs()));
    return shop;
  }

  /** Unmeasured setup after load: table view (for the sort headers), probe coordinates. */
  public void prepare(String cond) {
    if (!cond.equals("empty")) {
      page.locator("[data-testid=view-table]").click();
      page.locator("[data-testid=product-table]").waitFor();
    }
    BoundingBox box = page.locator(PROBE).boundingBox();
    probeX = box.x + box.width / 2;
    probeY = box.y + box.height / 2;
    settle();
  }

  public String workerError() {
    Object e = page.evaluate("() => window.__shop.workerError");
    return e == null ? "" : e.toString();
  }

  /** Back to the initial query between passes; waits for its result, not measured. */
  public void reset() {
    int n = queryCount();
    page.evaluate("() => window.__shop.reset()");
    waitPainted(n);
    settle();
  }

  /**
   * Runs one step and returns its row. The probe is a second click, sent while the
   * query should be running (after the search debounce). Its Event Timing
   * duration is the input delay a user would feel if they clicked then: with
   * the main strategy it waits for the compute, with the worker it shouldn't.
   */
  public Map<String, Object> run(Step step) {
    int n = queryCount();
    double since = now();
    Map<String, Double> m0 = metrics();

    switch (step) {
      case SORT_PRICE -> page.locator("[data-testid=sort-price]").click();
      case SORT_NAME -> page.locator("[data-testid=sort-name]").click();
      case SEARCH -> {
        page.locator("[data-testid=search]").click();
        page.keyboard().type(cfg.search(), new com.microsoft.playwright.Keyboard.TypeOptions().setDelay(60));
      }
      case CATEGORY -> page.locator("[data-testid=category-" + cfg.category() + "] input[type=checkbox]").click();
    }
    sleep((step == Step.SEARCH ? Config.SEARCH_DEBOUNCE_MS : 0) + cfg.probeDelayMs());
    page.mouse().click(probeX, probeY);

    waitPainted(n);
    Map<String, Double> m1 = metrics();
    @SuppressWarnings("unchecked")
    var summary = (Map<String, Object>) page.evaluate(SUMMARY_JS, List.of(n, since));

    var row = new LinkedHashMap<String, Object>(summary);
    row.put("heapUsedBeforeMb", m0.get("JSHeapUsedSize") / 1048576.0);
    row.put("heapUsedAfterMb", m1.get("JSHeapUsedSize") / 1048576.0);
    row.put("heapTotalAfterMb", m1.get("JSHeapTotalSize") / 1048576.0);
    row.put("taskMs", (m1.get("TaskDuration") - m0.get("TaskDuration")) * 1000);
    row.put("scriptMs", (m1.get("ScriptDuration") - m0.get("ScriptDuration")) * 1000);
    row.put("layoutMs", (m1.get("LayoutDuration") - m0.get("LayoutDuration")) * 1000);
    row.put("styleMs", (m1.get("RecalcStyleDuration") - m0.get("RecalcStyleDuration")) * 1000);
    settle();
    return row;
  }

  /** Per step, in the page: the painted query plus the harness observers' view of the same window. */
  private static final String SUMMARY_JS = """
      ([n, since]) => {
        const qs = window.__shop.queries.slice(n);
        const q = qs[qs.length - 1];
        const h = window.__harness;
        const end = q.paintedAt;
        const ev = h.events.filter((e) => e.s >= since && e.s <= end + 200 && e.i > 0);
        const probe = ev.filter((e) => e.t === "harness-probe");
        const own = ev.filter((e) => e.t !== "harness-probe");
        const lo = h.loaf.filter((e) => e.s + e.d >= since && e.s <= end);
        const max = (a, f) => a.reduce((m, x) => Math.max(m, f(x)), 0);
        const sum = (a, f) => a.reduce((m, x) => m + f(x), 0);
        return {
          ...q,
          paintedQueries: qs.length,
          interactionMs: own.length ? max(own, (e) => e.d) : null,
          interactionInputDelayMs: own.length ? max(own, (e) => e.ps - e.s) : null,
          probeMs: probe.length ? max(probe, (e) => e.d) : null,
          probeInputDelayMs: probe.length ? max(probe, (e) => e.ps - e.s) : null,
          loafCount: lo.length,
          loafBlockingMs: sum(lo, (e) => e.b),
          loafMaxMs: max(lo, (e) => e.d),
          loafScriptMs: sum(lo, (e) => e.sc),
        };
      }""";

  private void waitPainted(int n) {
    page.waitForFunction("n => window.__shop.queries.length > n", n,
        new Page.WaitForFunctionOptions().setPollingInterval(25).setTimeout(cfg.stepTimeoutMs()));
  }

  private int queryCount() {
    return ((Number) page.evaluate("() => window.__shop.queries.length")).intValue();
  }

  private double now() {
    return ((Number) page.evaluate("() => performance.now()")).doubleValue();
  }

  private Map<String, Double> metrics() {
    JsonObject r = cdp.send("Performance.getMetrics");
    var out = new HashMap<String, Double>();
    for (var m : r.getAsJsonArray("metrics")) {
      var o = m.getAsJsonObject();
      out.put(o.get("name").getAsString(), o.get("value").getAsDouble());
    }
    return out;
  }

  /** Let trailing work (paint, idle callbacks, the cart's storage write) finish so steps don't overlap. */
  private void settle() {
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)))");
  }

  private static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  @Override
  public void close() {
    if (tracing) browser.stopTracing();
    context.close();
  }
}
