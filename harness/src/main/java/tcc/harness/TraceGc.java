package tcc.harness;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * GC time per thread inside each query's window, from a Chrome trace.
 *
 * The window of query N is [shop:query:N:start, shop:query:N:painted]; both
 * marks are in the trace (blink.user_timing) on the renderer's main thread,
 * which also identifies the renderer process. MinorGC/MajorGC events on that
 * process are then split by thread name: CrRendererMain is the main thread, and
 * DedicatedWorker threads are the compute worker. This tests the "the main heap
 * holds React/Angular, the DOM wrappers and the 77 MB dataset" explanation
 * directly, instead of arguing it.
 *
 * Streaming parse: one pass, nothing but the small event lists kept in memory.
 */
public final class TraceGc {
  private static final Pattern MARK = Pattern.compile("^shop:query:(\\d+):(start|painted)$");

  public record Gc(double mainMs, int mainCount, double workerMs, int workerCount) {}

  private record Span(long pid, long tid, double ts, double dur) {}

  public static Map<Integer, Gc> perQuery(Path trace) throws IOException {
    Map<String, String> threadNames = new HashMap<>(); // "pid:tid" → name
    List<Span> gcs = new ArrayList<>();
    Map<Integer, double[]> windows = new HashMap<>(); // queryId → [start, painted] in µs
    long rendererPid = -1;

    try (InputStream in = Files.newInputStream(trace); JsonParser p = new JsonFactory().createParser(in)) {
      // Playwright writes {"traceEvents":[...], ...}; walk to the array.
      while (p.nextToken() != null) {
        if (p.currentToken() == JsonToken.FIELD_NAME && "traceEvents".equals(p.currentName())) {
          p.nextToken();
          break;
        }
      }
      while (p.nextToken() == JsonToken.START_OBJECT) {
        String name = null, ph = null, argName = null;
        long pid = 0, tid = 0;
        double ts = 0, dur = 0;
        while (p.nextToken() == JsonToken.FIELD_NAME) {
          String f = p.currentName();
          p.nextToken();
          switch (f) {
            case "name" -> name = p.getValueAsString();
            case "ph" -> ph = p.getValueAsString();
            case "pid" -> pid = p.getValueAsLong();
            case "tid" -> tid = p.getValueAsLong();
            case "ts" -> ts = p.getValueAsDouble();
            case "dur" -> dur = p.getValueAsDouble();
            case "args" -> argName = readArgName(p);
            default -> p.skipChildren();
          }
        }
        if (name == null) continue;
        if ("M".equals(ph) && "thread_name".equals(name) && argName != null) {
          threadNames.put(pid + ":" + tid, argName);
        } else if (("MinorGC".equals(name) || "MajorGC".equals(name)) && "X".equals(ph)) {
          gcs.add(new Span(pid, tid, ts, dur));
        } else {
          var m = MARK.matcher(name);
          if (m.matches()) {
            int id = Integer.parseInt(m.group(1));
            windows.computeIfAbsent(id, k -> new double[] {Double.NaN, Double.NaN})[m.group(2).equals("start") ? 0 : 1] = ts;
            rendererPid = pid;
          }
        }
      }
    }

    Map<Integer, Gc> out = new HashMap<>();
    for (var e : windows.entrySet()) {
      double s = e.getValue()[0], t = e.getValue()[1];
      if (Double.isNaN(s) || Double.isNaN(t)) continue;
      double mainUs = 0, workerUs = 0;
      int mainN = 0, workerN = 0;
      for (Span g : gcs) {
        if (g.pid != rendererPid) continue;
        double overlap = Math.min(t, g.ts + g.dur) - Math.max(s, g.ts);
        if (overlap <= 0) continue;
        String thread = threadNames.getOrDefault(g.pid + ":" + g.tid, "");
        if (thread.startsWith("CrRendererMain")) {
          mainUs += overlap;
          mainN++;
        } else if (thread.startsWith("DedicatedWorker")) {
          workerUs += overlap;
          workerN++;
        }
      }
      out.put(e.getKey(), new Gc(mainUs / 1000, mainN, workerUs / 1000, workerN));
    }
    return out;
  }

  /** args.name of a metadata event, skipping everything else in args. */
  private static String readArgName(JsonParser p) throws IOException {
    if (p.currentToken() != JsonToken.START_OBJECT) {
      p.skipChildren();
      return null;
    }
    String found = null;
    while (p.nextToken() == JsonToken.FIELD_NAME) {
      String f = p.currentName();
      p.nextToken();
      if ("name".equals(f) && p.currentToken() == JsonToken.VALUE_STRING) found = p.getValueAsString();
      else p.skipChildren();
    }
    return found;
  }
}
