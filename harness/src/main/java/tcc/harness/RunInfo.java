package tcc.harness;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;

/** What a result row must carry to be reproducible: commit, machine, browser. */
public record RunInfo(String runId, String commit, String os, int cores, long maxHeapMb, String browser) {

  public static RunInfo collect(Path repo, String browserVersion) {
    String commit = git(repo, "rev-parse", "--short", "HEAD");
    String dirty = git(repo, "status", "--porcelain", "--untracked-files=no");
    return new RunInfo(
        Instant.now().toString().replace(":", "").replace("-", "").substring(0, 15) + "Z",
        commit + (dirty.isBlank() ? "" : "-dirty"),
        System.getProperty("os.name") + " " + System.getProperty("os.version") + " " + System.getProperty("os.arch"),
        Runtime.getRuntime().availableProcessors(),
        Runtime.getRuntime().maxMemory() / (1024 * 1024),
        browserVersion);
  }

  private static String git(Path repo, String... args) {
    try {
      var cmd = new String[args.length + 1];
      cmd[0] = "git";
      System.arraycopy(args, 0, cmd, 1, args.length);
      var p = new ProcessBuilder(cmd).directory(repo.toFile()).redirectErrorStream(true).start();
      String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
      return p.waitFor() == 0 ? out : "unknown";
    } catch (IOException | InterruptedException e) {
      return "unknown";
    }
  }

  public String json() {
    return """
        {"runId":"%s","commit":"%s","os":"%s","cores":%d,"harnessMaxHeapMb":%d,"browser":"%s"}"""
        .formatted(runId, commit, os, cores, maxHeapMb, browser);
  }
}
