import { execFile } from "node:child_process";
import { join } from "node:path";

export function createPcControl({ enabled = false, dryRun = true, platform = process.platform,
  execute = execFile, now = Date.now, later = setTimeout, cancelTimer = clearTimeout } = {}) {
  const confirmations = new Map();
  let timer = null;
  let result = "Команд ещё не было.";
  function available() { return enabled && platform === "win32"; }
  return {
    request(key) {
      if (!available()) return "Выключение доступно только на Windows при PC_CONTROL_ENABLED=true.";
      if (timer) return "Отсчёт уже запущен. Можно отменить выключение.";
      confirmations.set(key, now() + 60_000);
      return "Выключить компьютер? Подтверди в течение минуты. После подтверждения будет 30 секунд для отмены.";
    },
    hasConfirmation(key) { return confirmations.has(key); },
    confirm(key) {
      const expires = confirmations.get(key);
      confirmations.delete(key);
      if (!expires || now() >= expires) return "Подтверждение отсутствует или истекло. Снова попроси выключить компьютер.";
      if (!available()) return "Управление ПК отключено.";
      if (timer) return "Отсчёт уже запущен.";
      if (dryRun) return (result = "Тестовый режим: команда подтверждена, компьютер остаётся включённым.");
      result = "Отсчёт 30 секунд. Для отмены используй /cancel_shutdown или скажи Алисе «отмени выключение».";
      timer = later(() => {
        timer = null;
        // A positive Windows /t implies /f. Countdown here avoids force-closing apps.
        const exe = join(process.env.SystemRoot || "C:\\Windows", "System32", "shutdown.exe");
        execute(exe, ["/s", "/t", "0"], { windowsHide: true, timeout: 10_000 }, (error) => {
          result = error ? "Windows отклонила выключение." : "Команда передана Windows. Приложения могут запросить сохранение.";
        });
      }, 30_000);
      return result;
    },
    cancel() {
      confirmations.clear();
      if (timer) cancelTimer(timer);
      timer = null;
      return (result = "Запрос и отсчёт выключения отменены.");
    },
    status() { return `${available() ? "Управление ПК включено." : "Управление ПК отключено."} ${dryRun ? "Тестовый режим." : "Реальный режим."} ${result}`; },
    stop() { if (timer) cancelTimer(timer); timer = null; confirmations.clear(); }
  };
}
