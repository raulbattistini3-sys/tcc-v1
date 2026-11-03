package tcc.harness;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Starts {@code node tools/serve.mjs} for the run, so the CSP / isolation
 * headers are part of the recorded configuration rather than whatever was left running.
 */
public final class DevServer implements AutoCloseable {
  private final Process process;

  private DevServer(Process process) {
    this.process = process;
  }

  public static DevServer start(Path repo, int port, String csp) throws IOException, InterruptedException {
    var pb = new ProcessBuilder("node", "tools/serve.mjs", "--port", String.valueOf(port), "--csp", csp)
        .directory(repo.toFile())
        .redirectErrorStream(true)
        .redirectOutput(ProcessBuilder.Redirect.DISCARD);
    var server = new DevServer(pb.start());
    var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
    var probe = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/react/")).method("HEAD", HttpRequest.BodyPublishers.noBody()).build();
    for (int i = 0; i < 50; i++) {
      if (!server.process.isAlive()) throw new IOException("serve.mjs exited with " + server.process.exitValue() + " (port " + port + " in use?)");
      try {
        if (http.send(probe, HttpResponse.BodyHandlers.discarding()).statusCode() == 200) return server;
      } catch (IOException notYet) {
        // not listening yet
      }
      Thread.sleep(100);
    }
    server.close();
    throw new IOException("serve.mjs did not answer on port " + port);
  }

  @Override
  public void close() {
    process.destroy();
  }
}
