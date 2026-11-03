package tcc.harness;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** One row per measured query. Fixed columns, written and flushed per sample. */
public final class CsvSink implements AutoCloseable {
  public static final List<String> COLUMNS = List.of(
      // what ran
      "runId", "commit", "browser", "app", "cond", "strategy", "match", "data", "throttle", "sample", "pass", "state", "step",
      // scheduler decision
      "queryId", "target", "reason", "explored", "predMainMs", "predWorkerMs", "budgetMs", "mainBusy", "pressure",
      // the run itself
      "total", "computeToResultMs", "mainBlockedMs", "prepareMs", "prepared", "filterMs", "sortMs", "sortClass",
      "postMs", "queueMs", "replyMs", "toPaintMs", "paintedQueries",
      // what the user would feel
      "interactionMs", "interactionInputDelayMs", "probeMs", "probeInputDelayMs",
      "loafCount", "loafBlockingMs", "loafMaxMs", "loafScriptMs",
      // CDP: main-thread heap and task time across the step
      "heapUsedBeforeMb", "heapUsedAfterMb", "heapTotalAfterMb", "taskMs", "scriptMs", "layoutMs", "styleMs",
      // trace (--trace): GC inside [query start, painted]
      "gcMainMs", "gcMainCount", "gcWorkerMs", "gcWorkerCount",
      "workerError");

  private final BufferedWriter w;

  public CsvSink(Path file) throws IOException {
    Files.createDirectories(file.getParent());
    w = Files.newBufferedWriter(file, StandardCharsets.UTF_8);
    w.write(String.join(",", COLUMNS));
    w.newLine();
  }

  public void write(List<Map<String, Object>> rows) throws IOException {
    for (var row : rows) {
      var sb = new StringBuilder();
      for (int i = 0; i < COLUMNS.size(); i++) {
        if (i > 0) sb.append(',');
        sb.append(cell(row.get(COLUMNS.get(i))));
      }
      w.write(sb.toString());
      w.newLine();
    }
    w.flush();
  }

  private static String cell(Object v) {
    if (v == null) return "";
    if (v instanceof Double d) return d.isNaN() || d.isInfinite() ? "" : String.format(Locale.ROOT, "%.3f", d);
    if (v instanceof Float f) return cell(f.doubleValue());
    String s = v.toString();
    return s.contains(",") || s.contains("\"") || s.contains("\n") ? '"' + s.replace("\"", "\"\"") + '"' : s;
  }

  @Override
  public void close() throws IOException {
    w.close();
  }
}
