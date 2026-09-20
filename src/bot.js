import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { cpus, freemem, hostname, loadavg, platform, release, totalmem, uptime } from "node:os";
import { dirname, resolve } from "node:path";

loadEnvFile();

const token = process.env.BOT_TOKEN;
const pollTimeoutSeconds = Number(process.env.POLL_TIMEOUT_SECONDS || 30);

if (!token || token.includes("replace_with_token")) {
  console.error("BOT_TOKEN is missing. Copy .env.example to .env and add your BotFather token.");
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
const dataPath = resolve(process.cwd(), "data", "bot-data.json");
const sessions = new Map();
let offset = 0;
let db = loadDatabase();

const keyboards = {
  main: keyboard([
    ["📝 Заметки", "✅ Дела"],
    ["🛒 Покупки", "⏰ Напоминания"],
    ["🌦 Погода", "💱 Валюта"],
    ["📊 Бюджет", "📔 Дневник"],
    ["🔥 Привычки", "🔗 Ссылки"],
    ["💻 Мой ПК", "🎲 Кубик", "🪙 Монетка"],
    ["⚙️ Настройки", "ℹ️ Помощь"]
  ]),
  notes: keyboard([["➕ Заметка", "📋 Заметки"], ["🧹 Очистить заметки"], ["⬅️ Главное меню"]]),
  tasks: keyboard([["➕ Дело", "📋 Дела"], ["✅ Закрыть дело"], ["🧹 Очистить дела"], ["⬅️ Главное меню"]]),
  shopping: keyboard([["➕ Покупка", "📋 Список покупок"], ["✅ Куплено"], ["🧹 Очистить покупки"], ["⬅️ Главное меню"]]),
  reminders: keyboard([["➕ Напоминание", "📋 Напоминания"], ["🧹 Очистить напоминания"], ["⬅️ Главное меню"]]),
  reminderTime: keyboard([["30 мин", "1 час"], ["1.5 часа", "2 часа"], ["+30 мин", "Сброс времени"], ["⬅️ Напоминания", "⬅️ Главное меню"]]),
  budget: keyboard([["➖ Расход", "➕ Доход"], ["📊 Статистика бюджета"], ["🧹 Очистить бюджет"], ["⬅️ Главное меню"]]),
  diary: keyboard([["➕ Запись в дневник", "📖 Последние записи"], ["🧹 Очистить дневник"], ["⬅️ Главное меню"]]),
  habits: keyboard([["➕ Привычка", "✅ Отметить привычку"], ["📈 Статистика привычек"], ["⬅️ Главное меню"]]),
  links: keyboard([["➕ Ссылка", "🔎 Найти ссылку"], ["📋 Все ссылки"], ["🧹 Очистить ссылки"], ["⬅️ Главное меню"]]),
  settings: keyboard([["🏙 Город для погоды"], ["⬅️ Главное меню"]])
};

console.log("Telegram bot is starting...");
await verifyBot();
setInterval(checkReminders, 15_000);
await pollLoop();

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function verifyBot() {
  while (true) {
    try {
      const me = await telegram("getMe");
      console.log(`Connected as @${me.username} (${me.first_name})`);
      return;
    } catch (error) {
      console.error(`Startup connection error: ${error.message}`);
      await sleep(3000);
    }
  }
}

async function pollLoop() {
  while (true) {
    try {
      const updates = await telegram("getUpdates", { offset, timeout: pollTimeoutSeconds, allowed_updates: ["message"] });
      for (const update of updates) {
        if (update.message) await handleMessage(update.message);
        offset = update.update_id + 1;
      }
    } catch (error) {
      console.error(`Polling error: ${error.message}`);
      await sleep(3000);
    }
  }
}

async function handleMessage(message) {
  const chatId = String(message.chat.id);
  const text = (message.text || "").trim();
  const user = userData(chatId);
  console.log(`Message from chat ${chatId}: ${text || "[non-text]"}`);

  if (!text) return send(chatId, "Я пока понимаю только текстовые сообщения.");
  if (await handleWaitingInput(chatId, text, user)) return;

  switch (text) {
    case "/start":
    case "⬅️ Главное меню":
      clearSession(chatId);
      return send(chatId, welcome(message.from?.first_name), keyboards.main);
    case "ℹ️ Помощь":
    case "/help":
      return send(chatId, helpText(), keyboards.main);
    case "🎲 Кубик":
    case "/roll":
      return send(chatId, `🎲 Выпало: ${randomInt(1, 6)}`);
    case "🪙 Монетка":
    case "/coin":
      return send(chatId, Math.random() < 0.5 ? "Орел" : "Решка");
    case "📝 Заметки": return send(chatId, "Раздел заметок.", keyboards.notes);
    case "✅ Дела": return send(chatId, "Раздел дел.", keyboards.tasks);
    case "🛒 Покупки": return send(chatId, "Список покупок.", keyboards.shopping);
    case "⏰ Напоминания": return send(chatId, "Напоминания.", keyboards.reminders);
    case "📊 Бюджет": return send(chatId, "Учет доходов и расходов.", keyboards.budget);
    case "📔 Дневник": return send(chatId, "Личный дневник.", keyboards.diary);
    case "🔥 Привычки": return send(chatId, "Трекер привычек.", keyboards.habits);
    case "🔗 Ссылки": return send(chatId, "База ссылок.", keyboards.links);
    case "⚙️ Настройки": return send(chatId, "Настройки бота.", keyboards.settings);
    case "🌦 Погода": return send(chatId, await weatherText(user.city));
    case "💱 Валюта": return send(chatId, await currencyText());
    case "💻 Мой ПК": return send(chatId, pcText());
    case "➕ Заметка": return ask(chatId, "note", "Напишите текст заметки.", keyboards.notes);
    case "📋 Заметки": return send(chatId, listItems(user.notes, "Заметок пока нет."), keyboards.notes);
    case "🧹 Очистить заметки": user.notes = []; save(); return send(chatId, "Заметки очищены.", keyboards.notes);
    case "➕ Дело": return ask(chatId, "task", "Напишите дело.", keyboards.tasks);
    case "📋 Дела": return send(chatId, listTasks(user.tasks), keyboards.tasks);
    case "✅ Закрыть дело": return ask(chatId, "doneTask", "Напишите номер выполненного дела.", keyboards.tasks);
    case "🧹 Очистить дела": user.tasks = []; save(); return send(chatId, "Список дел очищен.", keyboards.tasks);
    case "➕ Покупка": return ask(chatId, "shopping", "Что добавить в покупки?", keyboards.shopping);
    case "📋 Список покупок": return send(chatId, listItems(user.shopping, "Список покупок пуст."), keyboards.shopping);
    case "✅ Куплено": return ask(chatId, "bought", "Напишите номер купленного товара.", keyboards.shopping);
    case "🧹 Очистить покупки": user.shopping = []; save(); return send(chatId, "Покупки очищены.", keyboards.shopping);
    case "➕ Напоминание": return startReminderTime(chatId);
    case "📋 Напоминания": return send(chatId, listReminders(user.reminders), keyboards.reminders);
    case "⬅️ Напоминания":
      clearSession(chatId);
      return send(chatId, "Напоминания.", keyboards.reminders);
    case "30 мин": return setReminderMinutes(chatId, 30);
    case "1 час": return setReminderMinutes(chatId, 60);
    case "1.5 часа": return setReminderMinutes(chatId, 90);
    case "2 часа": return setReminderMinutes(chatId, 120);
    case "+30 мин": return addReminderMinutes(chatId, 30);
    case "Сброс времени": return startReminderTime(chatId);
    case "🧹 Очистить напоминания": user.reminders = []; save(); return send(chatId, "Напоминания очищены.", keyboards.reminders);
    case "➖ Расход": return ask(chatId, "expense", "Напишите расход: 250 кофе", keyboards.budget);
    case "➕ Доход": return ask(chatId, "income", "Напишите доход: 5000 аванс", keyboards.budget);
    case "📊 Статистика бюджета": return send(chatId, budgetText(user.budget), keyboards.budget);
    case "🧹 Очистить бюджет": user.budget = []; save(); return send(chatId, "Бюджет очищен.", keyboards.budget);
    case "➕ Запись в дневник": return ask(chatId, "diary", "Напишите запись в дневник.", keyboards.diary);
    case "📖 Последние записи": return send(chatId, diaryText(user.diary), keyboards.diary);
    case "🧹 Очистить дневник": user.diary = []; save(); return send(chatId, "Дневник очищен.", keyboards.diary);
    case "➕ Привычка": return ask(chatId, "habit", "Напишите название привычки.", keyboards.habits);
    case "✅ Отметить привычку": return ask(chatId, "habitDone", habitPrompt(user.habits), keyboards.habits);
    case "📈 Статистика привычек": return send(chatId, habitsText(user.habits), keyboards.habits);
    case "➕ Ссылка": return ask(chatId, "link", "Отправьте ссылку и описание. Например: https://example.com статья", keyboards.links);
    case "🔎 Найти ссылку": return ask(chatId, "findLink", "Напишите слово для поиска.", keyboards.links);
    case "📋 Все ссылки": return send(chatId, linksText(user.links), keyboards.links);
    case "🧹 Очистить ссылки": user.links = []; save(); return send(chatId, "Ссылки очищены.", keyboards.links);
    case "🏙 Город для погоды": return ask(chatId, "city", "Напишите город для погоды.", keyboards.settings);
    default:
      if (text.startsWith("/calc")) return send(chatId, calculate(text.slice("/calc".length).trim()));
      return send(chatId, "Не понял. Выберите действие кнопкой снизу.", keyboards.main);
  }
}

async function handleWaitingInput(chatId, text, user) {
  const session = sessions.get(chatId);
  if (!session) return false;

  if (session.type === "reminderTime") {
    const timeButtons = new Set(["30 мин", "1 час", "1.5 часа", "2 часа", "+30 мин", "Сброс времени", "⬅️ Напоминания", "⬅️ Главное меню"]);
    if (timeButtons.has(text)) return false;

    if (!session.minutes) {
      await send(chatId, "Сначала выберите срок кнопками снизу: 30 мин, 1 час, 1.5 часа, 2 часа или +30 мин.", keyboards.reminderTime);
      return true;
    }

    clearSession(chatId);
    const reminder = {
      text,
      at: new Date(Date.now() + session.minutes * 60_000).toISOString(),
      sent: false
    };
    user.reminders.push(reminder);
    save();
    await send(chatId, `Напомню через ${formatMinutes(session.minutes)}: ${new Date(reminder.at).toLocaleString("ru-RU")}\n\nМожно добавить еще напоминание или вернуться в главное меню.`, keyboards.reminders);
    return true;
  }

  clearSession(chatId);
  let answer = "Готово.";

  if (session.type === "note") user.notes.push(stamped(text));
  if (session.type === "task") user.tasks.push({ text, done: false, createdAt: nowIso() });
  if (session.type === "shopping") user.shopping.push(stamped(text));
  if (session.type === "diary") user.diary.push(stamped(text));
  if (session.type === "habit") user.habits.push({ name: text, dates: [] });
  if (session.type === "city") user.city = text;
  if (session.type === "expense" || session.type === "income") {
    const item = parseMoney(text, session.type);
    if (!item) {
      await send(chatId, "Не понял сумму. Пример: 250 кофе", session.keyboard);
      return true;
    }
    user.budget.push(item);
  }
  if (session.type === "link") {
    const link = parseLink(text);
    if (!link) {
      await send(chatId, "Не нашел ссылку. Пример: https://example.com статья", session.keyboard);
      return true;
    }
    user.links.push(link);
  }
  if (session.type === "reminderText") {
    const minutes = session.minutes || 30;
    const reminder = {
      text,
      at: new Date(Date.now() + minutes * 60_000).toISOString(),
      sent: false
    };
    user.reminders.push(reminder);
    answer = `Напомню через ${formatMinutes(minutes)}: ${new Date(reminder.at).toLocaleString("ru-RU")}`;
  }
  if (session.type === "reminder") {
    const reminder = parseReminder(text);
    if (!reminder) {
      await send(chatId, "Не понял время. Лучше нажмите «➕ Напоминание» и выберите срок кнопками.", session.keyboard);
      return true;
    }
    user.reminders.push(reminder);
    answer = `Напомню: ${new Date(reminder.at).toLocaleString("ru-RU")}`;
  }
  if (session.type === "doneTask") markByNumber(user.tasks, text, "done");
  if (session.type === "bought") removeByNumber(user.shopping, text);
  if (session.type === "habitDone") markHabit(user.habits, text);
  if (session.type === "findLink") {
    await send(chatId, linksText(user.links.filter((l) => `${l.url} ${l.note}`.toLowerCase().includes(text.toLowerCase()))), session.keyboard);
    return true;
  }

  save();
  await send(chatId, `${answer}\n\nМожно продолжить в этом разделе или выбрать другое действие кнопками снизу.`, session.keyboard);
  return true;
}

function ask(chatId, type, text, kb, extra = {}) {
  sessions.set(chatId, { type, keyboard: kb, ...extra });
  return send(chatId, text, kb);
}

function startReminderTime(chatId) {
  sessions.set(chatId, { type: "reminderTime", keyboard: keyboards.reminderTime, minutes: 0 });
  return send(chatId, "Выберите через сколько напомнить. Можно нажать готовый срок или набрать время кнопкой «+30 мин».", keyboards.reminderTime);
}

function setReminderMinutes(chatId, minutes) {
  return ask(chatId, "reminderText", `Отлично, напомню через ${formatMinutes(minutes)}. Теперь напишите текст напоминания.`, keyboards.reminderTime, { minutes });
}

function addReminderMinutes(chatId, minutesToAdd) {
  const session = sessions.get(chatId) || { minutes: 0 };
  const minutes = (session.minutes || 0) + minutesToAdd;
  sessions.set(chatId, { type: "reminderTime", keyboard: keyboards.reminderTime, minutes });
  return send(chatId, `Выбрано: ${formatMinutes(minutes)}. Нажмите «+30 мин» еще раз или выберите готовый срок. Когда время подходит, просто напишите текст напоминания.`, keyboards.reminderTime);
}

function clearSession(chatId) { sessions.delete(chatId); }

function userData(chatId) {
  db.users[chatId] ||= { city: "Moscow", notes: [], tasks: [], shopping: [], reminders: [], budget: [], diary: [], habits: [], links: [] };
  return db.users[chatId];
}

function loadDatabase() {
  if (!existsSync(dataPath)) return { users: {} };
  try { return JSON.parse(readFileSync(dataPath, "utf8")); } catch { return { users: {} }; }
}

function save() {
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify(db, null, 2), "utf8");
}

function keyboard(rows) {
  return { keyboard: rows.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true };
}

function welcome(name = "") {
  return `${name ? `Привет, ${name}!\n\n` : ""}Я стал полезнее: заметки, дела, покупки, напоминания, погода, валюта, бюджет, дневник, привычки, ссылки и быстрые кнопки снизу.`;
}

function helpText() {
  return "Выберите раздел кнопками снизу. Внутри разделов бот сам спросит нужный текст: задачу, покупку, сумму, город или напоминание.";
}

function stamped(text) { return { text, createdAt: nowIso() }; }
function nowIso() { return new Date().toISOString(); }

function listItems(items, empty) {
  if (!items.length) return empty;
  return items.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

function listTasks(tasks) {
  if (!tasks.length) return "Дел пока нет.";
  return tasks.map((task, index) => `${index + 1}. ${task.done ? "✅" : "⏳"} ${task.text}`).join("\n");
}

function markByNumber(items, value, field) {
  const index = Number(value) - 1;
  if (items[index]) items[index][field] = true;
}

function removeByNumber(items, value) {
  const index = Number(value) - 1;
  if (items[index]) items.splice(index, 1);
}

function parseMoney(text, type) {
  const match = text.match(/^(\d+(?:[.,]\d{1,2})?)\s*(.*)$/);
  if (!match) return null;
  return { type, amount: Number(match[1].replace(",", ".")), note: match[2] || "без описания", createdAt: nowIso() };
}

function budgetText(items) {
  const income = items.filter((i) => i.type === "income").reduce((sum, i) => sum + i.amount, 0);
  const expense = items.filter((i) => i.type === "expense").reduce((sum, i) => sum + i.amount, 0);
  const last = items.slice(-5).map((i) => `${i.type === "income" ? "+" : "-"}${i.amount} ${i.note}`).join("\n") || "Записей пока нет.";
  return `Доходы: ${income}\nРасходы: ${expense}\nБаланс: ${income - expense}\n\nПоследние записи:\n${last}`;
}

function diaryText(items) {
  if (!items.length) return "Записей пока нет.";
  return items.slice(-5).map((item) => `${new Date(item.createdAt).toLocaleString("ru-RU")}\n${item.text}`).join("\n\n");
}

function habitPrompt(habits) {
  if (!habits.length) return "Сначала добавьте привычку кнопкой «➕ Привычка».";
  return `Напишите номер привычки:\n${habits.map((h, i) => `${i + 1}. ${h.name}`).join("\n")}`;
}

function markHabit(habits, value) {
  const habit = habits[Number(value) - 1];
  if (!habit) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!habit.dates.includes(today)) habit.dates.push(today);
}

function habitsText(habits) {
  if (!habits.length) return "Привычек пока нет.";
  const today = new Date().toISOString().slice(0, 10);
  return habits.map((h, i) => `${i + 1}. ${h.dates.includes(today) ? "✅" : "▫️"} ${h.name}: ${h.dates.length} отметок`).join("\n");
}

function parseLink(text) {
  const match = text.match(/(https?:\/\/\S+)/i);
  if (!match) return null;
  return { url: match[1], note: text.replace(match[1], "").trim() || "без описания", createdAt: nowIso() };
}

function linksText(items) {
  if (!items.length) return "Ссылок не найдено.";
  return items.slice(-10).map((item, index) => `${index + 1}. ${item.note}\n${item.url}`).join("\n\n");
}

function parseReminder(text) {
  const lower = text.toLowerCase();
  const relative = lower.match(/^через\s+(\d+)\s*(минут|минуты|мин|час|часа|часов)\s+(.+)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].startsWith("час") ? 60 * 60_000 : 60_000;
    return { text: relative[3], at: new Date(Date.now() + amount * unit).toISOString(), sent: false };
  }
  const tomorrow = lower.match(/^завтра\s+(\d{1,2}):(\d{2})\s+(.+)$/);
  if (tomorrow) {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(Number(tomorrow[1]), Number(tomorrow[2]), 0, 0);
    return { text: tomorrow[3], at: at.toISOString(), sent: false };
  }
  return null;
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function listReminders(items) {
  const active = items.filter((item) => !item.sent);
  if (!active.length) return "Активных напоминаний нет.";
  return active.map((item, index) => `${index + 1}. ${new Date(item.at).toLocaleString("ru-RU")} - ${item.text}`).join("\n");
}

async function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const [chatId, user] of Object.entries(db.users)) {
    for (const reminder of user.reminders) {
      if (!reminder.sent && new Date(reminder.at).getTime() <= now) {
        reminder.sent = true;
        changed = true;
        await send(chatId, `⏰ Напоминание: ${reminder.text}`, keyboards.main);
      }
    }
  }
  if (changed) save();
}

async function weatherText(city) {
  try {
    const requestedCity = city || "Moscow";
    const location = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(requestedCity)}&count=1&language=ru&format=json`);
    const place = location.results?.[0];
    if (!place) return `Не удалось найти город «${requestedCity}». Проверьте его в настройках.`;

    const params = new URLSearchParams({ lat: String(place.latitude), lon: String(place.longitude) });
    const current = await getJson(`https://weather-api.madadipouya.com/v1/weather/current?${params}`);
    if (current.errors?.length) throw new Error(current.errors.join(", "));

    const area = [place.name, place.admin1, place.country].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(", ");
    return `Погода: ${area}\n${weatherDescription(current.weather?.[0]?.main)}\n${Math.round(current.temperature)}°C, ощущается как ${Math.round(current.feelsLike)}°C\nВетер: ${Math.round(current.wind?.speed || 0)} км/ч\nВлажность: ${current.main?.humidity ?? "—"}%`;
  } catch (error) {
    console.error(`Weather error: ${error.message}`);
    return "Не получилось получить погоду. Попробуйте позже или смените город в настройках.";
  }
}

function weatherDescription(condition) {
  const descriptions = {
    Clear: "Ясно",
    Clouds: "Облачно",
    Rain: "Дождь",
    Drizzle: "Морось",
    Thunderstorm: "Гроза",
    Snow: "Снег",
    Mist: "Дымка",
    Fog: "Туман",
    Haze: "Мгла",
    Smoke: "Дым"
  };
  if (descriptions[condition]) return descriptions[condition];
  return "Погодные условия без описания";
}

async function currencyText() {
  try {
    const data = await getJson("https://open.er-api.com/v6/latest/RUB");
    if (data.result !== "success") throw new Error(data["error-type"] || "Currency API error");
    const usd = 1 / data.rates?.USD;
    const eur = 1 / data.rates?.EUR;
    if (!Number.isFinite(usd) || !Number.isFinite(eur)) throw new Error("USD or EUR rate is missing");
    const updated = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toLocaleDateString("ru-RU") : "сегодня";
    return `Курс валют на ${updated}:\nUSD: ${formatRate(usd)} ₽\nEUR: ${formatRate(eur)} ₽`;
  } catch (error) {
    console.error(`Currency error: ${error.message}`);
    return "Не получилось получить курсы валют.";
  }
}

function formatRate(value) {
  return Number(value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function pcText() {
  const used = totalmem() - freemem();
  return `ПК: ${hostname()}\nOS: ${platform()} ${release()}\nCPU: ${cpus()[0]?.model || "unknown"}\nRAM: ${formatBytes(used)} / ${formatBytes(totalmem())}\nLoad: ${loadavg().map((n) => n.toFixed(2)).join(", ")}\nUptime: ${Math.floor(uptime() / 3600)} ч`;
}

function calculate(expression) {
  if (!expression) return "Напишите выражение после команды, например: /calc 2 + 2 * 5";
  if (!/^[\d\s+\-*/().,%]+$/.test(expression)) return "Можно использовать только числа и + - * / ( ) . , %";
  try {
    const result = Function(`"use strict"; return (${expression.replaceAll(",", ".")});`)();
    return Number.isFinite(result) ? `${expression} = ${result}` : "Результат не является конечным числом.";
  } catch {
    return "Не получилось посчитать выражение.";
  }
}

async function send(chatId, text, replyMarkup = keyboards.main) {
  await telegram("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

async function telegram(method, payload) {
  const data = await postJson(`${apiBase}/${method}`, payload || {});
  if (!data.ok) throw new Error(data.description || `Telegram API error in ${method}`);
  return data.result;
}

function postJson(url, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        try { resolveRequest(JSON.parse(responseBody)); } catch (error) { rejectRequest(new Error(`Invalid JSON from Telegram: ${error.message}`)); }
      });
    });
    req.on("error", rejectRequest);
    req.setTimeout((pollTimeoutSeconds + 10) * 1000, () => req.destroy(new Error("Telegram request timed out")));
    req.write(body);
    req.end();
  });
}

function getText(url) {
  return new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(url);
    const options = { method: "GET", headers: { "user-agent": "telegram-local-bot" } };
    const forcedIpv6 = {
      "weather-api.madadipouya.com": ["2606:4700:3032::6815:152", "2606:4700:3036::ac43:80e8"],
      "open.er-api.com": ["2a06:98c1:3123:8000::", "2a06:98c1:3122:8000::"]
    };
    if (forcedIpv6[target.hostname]) {
      const addresses = forcedIpv6[target.hostname];
      options.lookup = (_hostname, lookupOptions, callback) => {
        const results = addresses.map((address) => ({ address, family: 6 }));
        if (lookupOptions?.all) callback(null, results);
        else callback(null, results[0].address, results[0].family);
      };
    }
    const req = request(target, options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) return rejectRequest(new Error(`HTTP ${res.statusCode} from ${new URL(url).hostname}`));
        resolveRequest(body);
      });
    });
    req.on("error", rejectRequest);
    req.setTimeout(10_000, () => req.destroy(new Error("Request timed out")));
    req.end();
  });
}

async function getJson(url) {
  const body = await getText(url);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${error.message}`);
  }
}

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function formatBytes(bytes) { return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`; }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }


