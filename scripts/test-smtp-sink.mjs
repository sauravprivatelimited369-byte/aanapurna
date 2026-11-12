import { createServer } from "node:net";
import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inboxValue = process.env.LOCAL_SMTP_INBOX_PATH;
const port = Number(process.env.LOCAL_SMTP_SINK_PORT ?? 2526);

if (!inboxValue) {
  console.error("LOCAL_SMTP_INBOX_PATH is required; this test sink stores raw local verification email.");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("LOCAL_SMTP_SINK_PORT must be a TCP port between 1 and 65535.");
  process.exit(1);
}

const inboxPath = resolve(inboxValue);
let pendingWrites = Promise.resolve();

function appendMessage(message) {
  pendingWrites = pendingWrites.then(async () => {
    await mkdir(dirname(inboxPath), { recursive: true, mode: 0o700 });
    const inbox = await open(inboxPath, "a", 0o600);
    try {
      await inbox.chmod(0o600);
      await inbox.writeFile(`--- MESSAGE ---\r\n${message}\r\n`, "utf8");
    } finally {
      await inbox.close();
    }
  });
  return pendingWrites;
}

const server = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 localhost isolated test sink\r\n");
  let buffer = "";
  let receivingMessage = false;
  let messageLines = [];

  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (receivingMessage) {
        if (line === ".") {
          receivingMessage = false;
          const message = messageLines.join("\r\n");
          messageLines = [];
          void appendMessage(message)
            .then(() => socket.write("250 2.0.0 Message accepted\r\n"))
            .catch(() => {
              socket.write("451 4.3.0 Local test sink could not store the message\r\n");
              socket.destroy();
            });
        } else {
          messageLines.push(line.startsWith("..") ? line.slice(1) : line);
        }
        continue;
      }

      const [command = ""] = line.trim().split(/\s+/, 1);
      switch (command.toUpperCase()) {
        case "EHLO":
        case "HELO":
          socket.write("250-localhost\r\n250-SIZE 10485760\r\n250 8BITMIME\r\n");
          break;
        case "MAIL":
        case "RCPT":
          socket.write("250 2.1.0 OK\r\n");
          break;
        case "DATA":
          receivingMessage = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          break;
        case "RSET":
          messageLines = [];
          receivingMessage = false;
          socket.write("250 2.0.0 Reset\r\n");
          break;
        case "NOOP":
          socket.write("250 2.0.0 OK\r\n");
          break;
        case "QUIT":
          socket.write("221 2.0.0 Closing connection\r\n", () => socket.end());
          break;
        default:
          socket.write("502 5.5.1 Command not supported by local test sink\r\n");
      }
    }
  });

  socket.on("error", () => {
    // A client disconnect must not terminate the local test process.
  });
});

server.on("error", () => {
  console.error("Could not start the isolated SMTP test sink.");
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Isolated SMTP test sink listening on 127.0.0.1:${port}; message contents are not logged.`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void pendingWrites.finally(() => process.exit(0));
    });
  });
}
