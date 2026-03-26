const { spawn } = require("child_process");

const START_PORT = Number(process.env.PORT || 3000);
const MAX_PORT_RANGE = 20;

function runDevWithFallback(port, attemptsLeft) {
  const child = spawn(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "dev", "--webpack", "-p", String(port)],
    {
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
      },
    }
  );

  let retried = false;

  function handleChunk(chunk, writer) {
    const text = String(chunk || "");
    writer.write(chunk);

    if (!retried && /EADDRINUSE|address already in use/i.test(text)) {
      retried = true;
      const nextPort = port + 1;

      if (attemptsLeft <= 0) {
        console.error(`No free port found in range ${START_PORT}-${START_PORT + MAX_PORT_RANGE}`);
        process.exit(1);
      }

      console.warn(`Port ${port} is busy. Retrying frontend on port ${nextPort}.`);
      child.kill();
      runDevWithFallback(nextPort, attemptsLeft - 1);
    }
  }

  child.stdout.on("data", (chunk) => handleChunk(chunk, process.stdout));
  child.stderr.on("data", (chunk) => handleChunk(chunk, process.stderr));

  child.on("exit", (code) => {
    if (retried) return;
    process.exit(code == null ? 0 : code);
  });

  child.on("error", (error) => {
    if (retried) return;
    console.error("Failed to launch frontend dev process:", error?.message || error);
    process.exit(1);
  });
}

runDevWithFallback(START_PORT, MAX_PORT_RANGE);
