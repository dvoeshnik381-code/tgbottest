import test from "node:test";
import assert from "node:assert/strict";
import { createPcControl } from "../src/pc-control.js";
import { createAssistant, chunks } from "../src/assistant.js";
import { createAliceServer } from "../src/alice.js";

function fixture(extra = {}) {
  const users = {}; const messages = []; let saved = 0;
  const pc = createPcControl({ enabled: true, dryRun: true, platform: "win32" });
  const assistant = createAssistant({ ownerChatId: "123", userData: id => users[id] ||= { notes: ["old note"] },
    save: () => saved++, send: async (...args) => messages.push(args), clearSession: () => {},
    isNavigation: text => ["📝 Заметки", "⬅️ Главное меню"].includes(text), pc, ...extra });
  let messageId = 0;
  const message = text => ({ chat: { id: 123, type: "private" }, from: { id: 123 }, text,
    message_id: ++messageId, date: Math.floor(Date.now() / 1000) });
  return { assistant, pc, messages, users, message, saved: () => saved };
}

test("shutdown requires matching confirmation, expiry, and explicit enable", () => {
  let time = 0; let runs = 0;
  const pc = createPcControl({ enabled: true, platform: "win32", now: () => time, execute: () => runs++ });
  assert.match(pc.confirm("telegram:123"), /отсутствует/);
  pc.request("alice:one");
  assert.match(pc.confirm("alice:two"), /отсутствует/);
  time = 61_000;
  assert.match(pc.confirm("alice:one"), /истекло/);
  pc.request("telegram:123");
  assert.match(pc.confirm("telegram:123"), /Тестовый режим/);
  assert.equal(runs, 0);
  assert.match(createPcControl({ platform: "win32" }).request("x"), /PC_CONTROL_ENABLED/);
  assert.match(createPcControl({ enabled: true, platform: "linux" }).request("x"), /Windows/);
});

test("real countdown is cancellable and never force closes programs", () => {
  let callback; let cleared = 0; let call;
  const pc = createPcControl({ enabled: true, dryRun: false, platform: "win32",
    later: (fn, ms) => { callback = fn; assert.equal(ms, 30_000); return 1; },
    cancelTimer: () => cleared++, execute: (...args) => { call = args; args[3](null); } });
  pc.request("x"); pc.confirm("x");
  assert.match(pc.confirm("x"), /отсутствует/);
  pc.cancel(); assert.equal(cleared, 1); assert.equal(call, undefined);
  pc.request("x"); pc.confirm("x"); callback();
  assert.deepEqual(call[1], ["/s", "/t", "0"]);
  assert.equal(call[2].shell, undefined);
  assert.match(pc.status(), /передана Windows/);
});

test("only owner in private chat can use assistant and PC", async () => {
  const { assistant, message, users, messages } = fixture();
  for (const invalid of [
    { ...message("/shutdown"), from: { id: 9 } },
    { ...message("/shutdown"), chat: { id: 123, type: "group" } },
    { ...message("/shutdown"), chat: { id: 9, type: "private" } }
  ]) assert.equal(await assistant.handleTelegram(invalid), true);
  assert.equal(Object.keys(users).length, 0);
  assert.equal(messages.length, 3);
  assert.ok(messages.every(([, text]) => text.includes("владельцу")));
});

test("memory is shared with Alice, retained by storage, and does not erase notes", async () => {
  const f = fixture();
  await f.assistant.handleTelegram(f.message("/remember Windows 10"));
  assert.match(f.assistant.handleAlice("что ты помнишь", "a"), /Windows 10/);
  assert.equal(f.saved(), 1);
  f.assistant.handleAlice("забудь всё", "a");
  assert.deepEqual(f.users["123"].notes, ["old note"]);
  assert.equal(f.assistant.state().memory.length, 0);
});

test("old and duplicate Telegram shutdown commands are rejected", async () => {
  const f = fixture();
  await f.assistant.handleTelegram({ ...f.message("/shutdown"), date: 1 });
  assert.equal(f.pc.hasConfirmation("telegram:123"), false);
  const fresh = f.message("/shutdown");
  await f.assistant.handleTelegram(fresh);
  assert.equal(f.pc.hasConfirmation("telegram:123"), true);
  f.pc.cancel();
  await f.assistant.handleTelegram(fresh);
  assert.equal(f.pc.hasConfirmation("telegram:123"), false);
  assert.match(f.messages.at(-1)[1], /уже обработана/);
});

test("AI request uses context, sends full answer, and does not block existing menus", async () => {
  let finish; let payload;
  const gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ apiKey: "test-key", fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body); await gate;
    return { ok: true, json: async () => ({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "Ответ " + "😀".repeat(4000) }] }] }) };
  } });
  await f.assistant.handleTelegram(f.message("/remember важное"));
  await f.assistant.handleTelegram(f.message("🧠 ИИ-помощник"));
  await f.assistant.handleTelegram(f.message("вопрос"));
  assert.equal(payload.store, false);
  assert.match(payload.instructions, /важное/);
  assert.match(f.assistant.handleAlice("готово", "a"), /готовлю/);
  assert.equal(await f.assistant.handleTelegram(f.message("📝 Заметки")), false);
  finish(); await f.assistant.pending();
  assert.match(f.assistant.state().lastAnswer, /Ответ/);
  assert.ok(f.messages.every(([, text]) => text.length <= 4096));
  assert.equal(f.assistant.state().history.length, 2);
});

test("Telegram delivery and API failures do not claim success", async () => {
  const f = fixture({ apiKey: "key", fetchImpl: async () => ({ ok: false }) });
  await f.assistant.handleTelegram(f.message("/ask вопрос")); await f.assistant.pending();
  assert.equal(f.assistant.state().lastAnswer, "");
  assert.match(f.messages.at(-1)[1], /Не удалось/);
});

test("Unicode message splitting preserves text and fits Telegram limits", () => {
  const text = "😀 текст ".repeat(2000);
  const parts = chunks(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => part.length < 4096));
});

test("Alice authenticates owner/device, prevents webhook retry, and responds promptly", async () => {
  const token = "x".repeat(40); let calls = 0;
  const server = createAliceServer({ token, userId: "owner", applicationId: "station", assistant: {
    handleAlice(text) { calls++; return "Принято: " + text; }
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { session: { session_id: "a", message_id: 1, user: { user_id: "owner" }, application: { application_id: "station" } }, request: { command: "выключи компьютер" } };
  const post = (path, data) => fetch(base + path, { method: "POST", body: JSON.stringify(data) });
  try {
    assert.equal((await post("/alice/wrong", body)).status, 403);
    const stranger = structuredClone(body); stranger.session.user.user_id = "stranger";
    assert.match((await (await post(`/alice/${token}`, stranger)).json()).response.text, /другого аккаунта/);
    const started = Date.now();
    const first = await (await post(`/alice/${token}`, body)).json();
    assert.ok(Date.now() - started < 4000);
    assert.equal(first.version, "1.0"); assert.equal(first.response.end_session, false);
    assert.deepEqual(await (await post(`/alice/${token}`, body)).json(), first);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("Alice pairing mode cannot run commands or expose existing memory", async () => {
  let calls = 0;
  const server = createAliceServer({ token: "x".repeat(40), pairing: true, assistant: { handleAlice() { calls++; } } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/alice/${"x".repeat(40)}`, { method: "POST", body: JSON.stringify({ session: { session_id: "a", message_id: 0 }, request: { command: "подтверждаю" } }) });
    assert.match((await response.json()).response.text, /настройки/);
    assert.equal(calls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
