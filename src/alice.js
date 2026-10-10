import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

function equal(a, b) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
export function createAliceServer({ token, userId, applicationId, pairing = false, assistant }) {
  if (!token || token.length < 32 || token.includes("replace")) throw new Error("ALICE_WEBHOOK_TOKEN must be a random secret of at least 32 characters.");
  if (!pairing && (!userId || !applicationId)) throw new Error("Set ALICE_USER_ID/ALICE_APPLICATION_ID or enable pairing mode.");
  const cache = new Map();
  const server = createServer((request, response) => {
    const reply = (code, body) => { response.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
    if (request.method !== "POST" || !equal(request.url || "", `/alice/${token}`)) return reply(403, { error: "Access denied" });
    let raw = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", chunk => { size += Buffer.byteLength(chunk); if (size > 65536) request.destroy(); else raw += chunk; });
    request.on("end", () => {
      try {
        const body = JSON.parse(raw);
        const session = body.session;
        if (!session || typeof session.session_id !== "string" || !Number.isInteger(session.message_id)) return reply(400, { error: "Invalid session" });
        const actualUser = session.user?.user_id || session.user_id;
        const actualApp = session.application?.application_id;
        let text;
        if (pairing) {
          console.log("ALICE_PAIRING", JSON.stringify({ ALICE_USER_ID: actualUser, ALICE_APPLICATION_ID: actualApp }));
          text = "Режим настройки. Идентификаторы колонки показаны в терминале бота. Команды пока отключены.";
        } else if (actualUser !== userId || actualApp !== applicationId) {
          text = "Этот навык настроен для другого аккаунта или устройства.";
        } else {
          const key = `${session.session_id}:${session.message_id}`;
          if (cache.has(key)) return reply(200, cache.get(key));
          if (typeof body.request?.command !== "string") return reply(400, { error: "Invalid command" });
          text = assistant.handleAlice(body.request.command.slice(0, 4000), session.session_id);
          const answer = envelope(text);
          cache.set(key, answer);
          if (cache.size > 500) cache.delete(cache.keys().next().value);
          return reply(200, answer);
        }
        reply(200, envelope(text));
      } catch { reply(400, { error: "Invalid request" }); }
    });
  });
  server.requestTimeout = 4000;
  server.headersTimeout = 4000;
  return server;
}

function envelope(text) {
  const spoken = text.length > 850 ? Array.from(text).slice(0, 700).join("") + ". Полный ответ могу отправить в Телеграм." : text;
  return { version: "1.0", response: { text: spoken, end_session: false } };
}
