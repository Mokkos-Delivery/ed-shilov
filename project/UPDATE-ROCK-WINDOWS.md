# ROCK 2 — установка обновления в Windows

Выпуск: 2026-11-12-rock-2. Архив EDUARD_ROCK2_UPDATE_2026-11-12.zip.
Включает рок-дизайн ROCK 1, статистику, ускорение старта, очищенную студию
и дополнительного администратора huyencehdofen8632@gmail.com.
Исходники сами не меняют работающий сайт: нужны правила Firestore, Worker и Hosting.

В PowerShell выполняйте команды ПО ОДНОЙ. При ошибке остановитесь и сохраните вывод.

1. Скачайте ZIP в C:\eduard-site. Сохраните резервную копию и распакуйте:

Copy-Item -LiteralPath 'C:\eduard-site' -Destination ('C:\eduard-site-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Recurse
Expand-Archive -LiteralPath 'C:\eduard-site\EDUARD_ROCK2_UPDATE_2026-11-12.zip' -DestinationPath 'C:\eduard-site' -Force
Set-Location 'C:\eduard-site\project'

Не удаляйте существующую папку. Архив сохраняет ваши settings.json,
worker/wrangler.jsonc, credentials, секреты и подтверждение правил Firestore.
project/, source/, audit.json и media-inventory.json должны остаться рядом,
как в архиве. Не распаковывайте весь ZIP внутрь project/.

2. Проверка и сборка. Нужны Node >=24.12.0 и ранее установленный ffprobe.

Test-Path .\settings.json
Test-Path .\worker\wrangler.jsonc
node --version
npm.cmd ci --no-audit --no-fund
npm.cmd run doctor -- --strict
npm.cmd test
npm.cmd run build
npm.cmd run check

Оба Test-Path должны вернуть True. Новая команда npm test запускает тесты,
включённые в выпуск. Старый локальный tests/track-metrics.test.mjs из вашего
лога не входит в него и не удаляется. Текущий трекер проверяется отдельными
тестами аналитики. Не подменяйте рабочие настройки примерами.

3. ОБЯЗАТЕЛЬНО опубликуйте правила доступа, включая второго администратора:

node .\tools\deploy-firestore-rules.cjs --firebase-cli --apply

Нужна сессия Firebase CLI владельца проекта wefewfwewfewef853@gmail.com.
Если получена FIREBASE_CLI_ACCOUNT_MISMATCH:

npx.cmd firebase login:add
npx.cmd firebase login:use wefewfwewfewef853@gmail.com
node .\tools\deploy-firestore-rules.cjs --firebase-cli --apply

Утилита сохраняет предыдущие правила и подтверждает опубликованную версию.
Она узнаёт точные правила прежнего выпуска даже при отсутствии локального
подтверждения. Неизвестные изменённые правила не перезаписываются: при ошибке
сохраните вывод для разбора. Не удаляйте проверки из deploy:hosting.
Именно отсутствие подтверждения правил остановило Hosting в вашем логе.

4. Обновите вход Cloudflare и подключите статистику:

npx.cmd wrangler login
npm.cmd run setup:analytics -- --apply

Выберите аккаунт, где работает текущий Worker. Повторная настройка использует
имеющуюся D1. Конфигурация сохраняется в credentials/wrangler-before-analytics.jsonc.
Ваш прошлый запуск остановился на d1 list; точная причина в логе не указана.
Если повторится ошибка, выполните диагностическую команду и пришлите вывод
без токенов и секретов:

npx.cmd wrangler d1 list --json --config .\worker\wrangler.jsonc

До успешной настройки D1 не переходите к публикации.

5. Опубликуйте сервер и сайт:

npm.cmd run deploy:worker -- --apply
npm.cmd run deploy:hosting -- --apply
npm.cmd run verify:live

Ожидаются workerVerified: true, hostingVerified: true,
analyticsConfigured: true и выпуск 2026-11-12-rock-2.
Откройте https://eduardshilov.com/ и нажмите Ctrl+F5.
В студии https://eduardshilov.com/admin.html внизу указан выпуск.
Проверка сравнивает файлы на стандартном адресе Firebase; дополнительная
проверка собственного домена:

(Invoke-RestMethod 'https://eduardshilov.com/build-manifest.json').release

Ожидается 2026-11-12-rock-2. Другой выпуск/404 означает, что собственный домен
ещё не отдаёт эту публикацию; это не подтверждение успешного обновления.

6. Дополнительный администратор.

Выйдите из студии и войдите через Google как huyencehdofen8632@gmail.com.
Прежний владелец сохраняет доступ. Изменения действуют только после шага 5;
они не создают Google-аккаунт и не отправляют приглашение.
Для загрузки файлов предоставьте этой почте роль «Редактор» в существующей
папке публикаций Google Drive. Для OAuth-приложения в режиме Testing также
добавьте почту в список тестовых пользователей Google Auth Platform → Audience.
Разрешение в студии не заменяет права Google Drive. Выбирайте существующую
папку в системном окне Google, если оно запросит доступ.
«База данных подключена» означает ответ Firestore. Доступ к загрузкам
при необходимости запрашивается отдельно кнопкой «Подключить хранилище».

Если auth/unauthorized-domain остаётся: Firebase Console → Authentication →
Settings → Authorized domains → Add domain → eduardshilov.com.
www.eduardshilov.com добавьте, если используете и этот адрес.
Это разрешённые домены входа, а не DNS. authDomain в settings.json оставьте
eduard-shilov-site.firebaseapp.com.

Статистика: админка → Статистика. Считаются новые события посетителей,
разрешивших аналитику. Прошлую историю восстановить нельзя; см. ANALYTICS.md.

Для проверки правил локально нужен Java 21+:
npm.cmd run test:rules
В облачной среде этот тест заблокирован загрузкой эмулятора сетевой политикой;
успешный запуск здесь не заявляется. API Firebase проверяет правила при публикации.

Откат: восстановите исходники и настройки из копии, npm ci, сборку, прежние
правила Firestore, Worker и Hosting. Публикация прежних правил отзовёт доступ
нового администратора. Не удаляйте D1: иначе потеряется статистика.
