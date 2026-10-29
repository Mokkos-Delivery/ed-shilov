# Студия Эдуарда Шилова — Studio 4

[Скачать готовый ZIP обновления](https://github.com/Mokkos-Delivery/ed-shilov/raw/refs/heads/main/downloads/EDUARD_STUDIO_UPDATE_2026-10-29.zip). Сохраните исходное имя архива и используйте команды из `UPDATE-WINDOWS.txt`. В этом ZIP папки `project/` и `source/` находятся прямо в корне; GitHub Code → Download ZIP дополнительно создаёт обёртку `ed-shilov-main/`.

Обновлённые исходники находятся в `project/`, сохранённый публичный сайт — в `source/`.
Обе папки и корневые `audit.json`/`media-inventory.json` нужны для сборки.

- Начните с [команд Windows](UPDATE-WINDOWS.txt).
- Изменения, доказательства и ограничения: [отчёт](project/REPORT-2026-10-29.md).
- Браузерные скриншоты и протокол: `review/` в архиве обновления.
- `PROMPT_NEXT_CHAT.md`, старые `SETUP.md`, `DEPLOY.md` и JSON-отчёты из исходного архива — исторические материалы. Для этого обновления используйте новые команды и отчёт.

Требуется Node.js >= 24.12.0. Локально: `cd project`, `npm ci`, `npm test`, `npm run build -- --draft`, `npm run check`.
`--draft` подходит для разработки и проверки; публикация выполняет полноценную сборку с существующим `settings.json`.

Архив обновления не содержит локальные настройки, credentials, серверные секреты,
собранный `public/`, кэши и node_modules. Он не стирает эти папки при распаковке поверх старой установки.
Рабочие Google/Firebase/Cloudflare авторизации из предыдущего компьютера не переносятся в новую среду автоматически.
