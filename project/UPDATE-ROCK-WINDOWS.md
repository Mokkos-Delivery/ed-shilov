# Обновление ROCK 1: сайт, концерты и статистика

Архив `EDUARD_ROCK_UPDATE_2026-11-12.zip` распаковывается поверх `C:\eduard-site`.
Он содержит исходники, а не готовую публикацию. Настройки, секреты и песни в архив не включены.
Нынешняя студия сохранена; новая вкладка — «Статистика».

## Обновление существующего рабочего сайта

Команды выполняйте в PowerShell по одной. Если команда завершилась ошибкой, не продолжайте к следующему развёртыванию.

1. Сохраните ZIP в `C:\eduard-site\EDUARD_ROCK_UPDATE_2026-11-12.zip` и сделайте копию текущей папки:

```powershell
Copy-Item -LiteralPath 'C:\eduard-site' -Destination ('C:\eduard-site-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Recurse
Expand-Archive -LiteralPath 'C:\eduard-site\EDUARD_ROCK_UPDATE_2026-11-12.zip' -DestinationPath 'C:\eduard-site' -Force
Set-Location 'C:\eduard-site\project'
```

Не удаляйте текущую папку. Архив не заменяет `settings.json`, `worker/wrangler.jsonc`, `credentials/`, `.env*`, `.dev.vars*` и подтверждение публикации Firestore. Если вы используете отдельный каталог установки, копируйте туда и корневой `source/`, `audit.json`, `media-inventory.json`.

2. Проверьте настройки и установите зависимости. Нужен Node 24.12.0+; для аудиотестов — `ffprobe`, установленный в предыдущем обновлении.

```powershell
Test-Path .\settings.json
Test-Path .\worker\wrangler.jsonc
node --version
ffprobe -version
npm.cmd ci --no-audit --no-fund
npm.cmd run doctor -- --strict
npm.cmd test
npm.cmd run build
npm.cmd run check
npm.cmd run test:hosting
npm.cmd run test:analytics:runtime
```

Оба `Test-Path` должны вернуть `True`. Если файла нет — восстановите его из своей копии. Примеры настроек не заменяют рабочие значения. `npm ci` предварительно создаёт черновую сборку; отдельный `npm run build` создаёт сборку для публикации с вашими настройками.

3. Подключите статистику в существующем аккаунте Cloudflare:

```powershell
npm.cmd run setup:analytics -- --apply
```

Команда находит или создаёт D1 `eduard-shilov-analytics`, применяет миграцию и добавляет привязку к текущему Worker, ограничение частоты и ежедневную очистку. Повторный запуск использует существующую базу. Исходная конфигурация сохраняется в `credentials/wrangler-before-analytics.jsonc`. Сайт ещё не публикуется. Если Wrangler сообщает, что вход истёк, выполните `npx.cmd wrangler login` и повторите команду. Входите в тот же аккаунт, где уже работает ваш Worker.

4. Опубликуйте обновление и проверьте его:

```powershell
npm.cmd run deploy:worker -- --apply
npm.cmd run deploy:hosting -- --apply
npm.cmd run verify:live
```

В последнем отчёте ожидаются `workerVerified: true`, `hostingVerified: true`, `analyticsConfigured: true` и выпуск `2026-11-10-rock-1`. Проверяются реальные байты публичных страниц, стилей, скриптов и шрифтов. Это не подтверждает доставку почты, Google-вход или загрузку реального трека: их проверяют отдельно в браузере.

5. Откройте `https://eduard-shilov-site.web.app/admin` → войдите владельцем → **Статистика**. Доступны 7/30/90 дней, график, все песни, страницы, переходы к выступлениям и CSV.

Для проверки сбора откройте публичный сайт, разрешите аналитику в настройках приватности, перейдите к песням и прослушайте трек 30 секунд. Затем обновите отчёт в студии. Короткие песни учитываются после 90% прослушивания. Ранее накопленной истории нет: сбор начинается после установки. Визит — сеанс вкладки, а не уникальный человек; учитываются только согласившиеся посетители. Подробнее — `ANALYTICS.md`.

Для проверки заявок: откройте блок выступлений → выберите формат → убедитесь, что он выбран в форме. Реальную заявку отправляйте только когда хотите отправить письмо.

## Домен

Это обновление не изменяет DNS и настройки домена. Если подключение `eduardshilov.com` и HTTPS ещё не завершено, сначала проверяйте по адресу `eduard-shilov-site.web.app`. Для входа/формы на собственном домене он должен быть разрешён в Firebase Authentication, Google OAuth/Picker и Cloudflare Turnstile; Worker уже должен разрешать его Origin. `settings.firebase.authDomain` остаётся `eduard-shilov-site.firebaseapp.com`.

## Возврат предыдущей версии

Верните исходники из резервной копии вместе с её настройками, затем выполните `npm.cmd ci`, `npm.cmd run deploy:worker -- --apply` и `npm.cmd run deploy:hosting -- --apply`. Не удаляйте D1: она не мешает старому сайту, а удаление уничтожит статистику. Для восстановления текущей конфигурации Worker отдельно используйте созданную локальную копию. Архив не переключает тарифы и не публикует посты в Telegram.
