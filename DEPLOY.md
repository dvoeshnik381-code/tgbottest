# Деплой Telegram-бота

GitHub хранит код, но не запускает Telegram-бота постоянно. Для режима 24/7 нужен хостинг, который будет держать Node.js процесс включенным.

## Ubuntu-сервер

Запустите от имени `root`:

```bash
curl -fsSL https://raw.githubusercontent.com/dvoeshnik381-code/tgbottest/main/deploy-server.sh | bash
```

Установщик запросит токен BotFather скрытым вводом, установит Node.js и Git, затем создаст службу `tgbottest`. Повторный запуск команды обновляет код и сохраняет `.env` и каталог `data/`.

Проверка состояния и просмотр логов:

```bash
systemctl status tgbottest --no-pager
journalctl -u tgbottest -f
```

## Что подготовлено

- `.env` не попадет в GitHub.
- `data/` не попадет в GitHub, потому что там личные заметки, дела и покупки.
- Команда запуска: `node src/bot.js`.
- Переменная окружения: `BOT_TOKEN`.

## Вариант 1: Render

1. Загрузите проект на GitHub.
2. Откройте Render и создайте `Background Worker`.
3. Подключите GitHub-репозиторий.
4. Укажите:
   - Build Command: пусто или `npm install`
   - Start Command: `node src/bot.js`
5. В Environment Variables добавьте:
   - `BOT_TOKEN` = токен от BotFather
   - `POLL_TIMEOUT_SECONDS` = `30`
6. Запустите deploy.

## Вариант 2: Railway

1. Загрузите проект на GitHub.
2. Создайте новый Railway project из GitHub repository.
3. В Variables добавьте:
   - `BOT_TOKEN` = токен от BotFather
   - `POLL_TIMEOUT_SECONDS` = `30`
4. Railway сам увидит Node.js проект.
5. Если потребуется, задайте Start Command: `node src/bot.js`.

## Важно про данные

Сейчас бот хранит данные в локальном файле `data/bot-data.json`. На некоторых хостингах файловая система может очищаться при redeploy. Для серьезного постоянного хранения лучше позже подключить базу данных: SQLite с persistent disk, PostgreSQL или Redis.

## Безопасность

Не добавляйте `.env` в GitHub. Токен нужно хранить только в переменных окружения хостинга.
