# ROCK 3 — скорость сайта и подключение хранилища

Выпуск 2026-11-12-rock-3. ZIP: EDUARD_ROCK3_UPDATE_2026-11-12.zip.
Все исправления ROCK 1/2 и второй администратор сохранены.

1. Сохраните ZIP в C:\eduard-site, сделайте копию текущей папки.
В PowerShell выполняйте команды по одной, при ошибке остановитесь:

Copy-Item -LiteralPath 'C:\eduard-site' -Destination ('C:\eduard-site-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Recurse
Expand-Archive -LiteralPath 'C:\eduard-site\EDUARD_ROCK3_UPDATE_2026-11-12.zip' -DestinationPath 'C:\eduard-site' -Force
Set-Location 'C:\eduard-site\project'
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run prepare:images -- --apply
npm.cmd run build
npm.cmd run check
npm.cmd run deploy:worker -- --apply
npm.cmd run deploy:hosting -- --apply
npm.cmd run verify:live

Не удаляйте рабочую папку, settings.json, worker/wrangler.jsonc, credentials,
firestore-deployment.json. Секреты и настройки в ZIP не входят.
Требования остаются: Node >=24.12.0, установленный ffprobe.

prepare:images — новый обязательный шаг для ускорения картинок.
Он скачивает только уже публичные изображения, указанные на страницах и
в каталоге, через действующий Worker. Создаёт WebP-версии шириной до
320/640/1280 пикселей и сохраняет их в .image-cache. Первая обработка
может занять несколько минут (около 60–70 МБ исходных картинок); при повторе
готовые файлы используются из кеша. Размер первой загрузки сборщиком не
является размером страницы для посетителя. Если несколько картинок не
скачались — повторите эту команду: завершённые повторно не скачиваются.
Оригиналы в Drive не изменяются. Публичные миниатюры публикуются на Hosting
с именами по содержимому и кешем на год. Новые картинки из админки работают
через Worker сразу. Эта команда оптимизирует изображения исходной
сборки; новые материалы админки продолжают загружаться через Worker. Не удаляйте .image-cache между сборками.

Для уже установленного ROCK 2 правила Firestore не изменились.
Если Hosting всё же сообщает Publish and verify the current Firestore rules first:

node .\tools\deploy-firestore-rules.cjs --firebase-cli --apply
npm.cmd run deploy:hosting -- --apply

Нужна сессия Firebase CLI владельца проекта wefewfwewfewef853@gmail.com.
При FIREBASE_CLI_ACCOUNT_MISMATCH:

npx.cmd firebase login:add
npx.cmd firebase login:use wefewfwewfewef853@gmail.com

Если статистика ещё не подключена или verify:live сообщает storage is missing:

npx.cmd wrangler login
npm.cmd run setup:analytics -- --apply
npm.cmd run deploy:worker -- --apply
npm.cmd run verify:live

Выберите существующий аккаунт Cloudflare с вашим Worker.

2. ВТОРОЙ АККАУНТ И ПАПКА.

Просьба выбрать «Публикации сайта» — первое разрешение Google для этого
аккаунта. Приложение использует ограниченный доступ drive.file; разрешение
первого аккаунта не передаётся второму. Владелец папки должен предоставить
huyencehdofen8632@gmail.com роль «Редактор», затем второй аккаунт один раз
выбирает существующую папку в окне Google. Новую папку создавать не нужно.

Прямая ссылка на существующую папку (открывайте владельцем для выдачи роли):
https://drive.google.com/drive/folders/12XvWmddZKZveffm-mc39DpXJLDeVZ2zH

После успешного подключения действующий доступ восстанавливается при
перезагрузке и в новой вкладке без повторного окна. Если Google-токен истёк,
нажатие «Опубликовать» само запускает подтверждение Google, сохраняя выбранные
файлы; отдельное предварительное нажатие «Подключить хранилище» не требуется.
При восстановлении сессии окно выбора папки само не открывается. Ошибка
доступа выводится текстом; запрос к Google ограничен 12 секундами.
Отмену/истечение разрешений Google нельзя обойти автоматически. Выйдя из
аккаунта, вы очищаете сохранённый доступ — это ожидаемое поведение.

3. ПРОВЕРКА ПОСЛЕ ПУБЛИКАЦИИ.

(Invoke-RestMethod 'https://eduardshilov.com/build-manifest.json').release

Ожидается 2026-11-12-rock-3. Откройте сайт с Ctrl+F5, затем выполните Lighthouse
заново. Старый отчёт показывает старую версию. В Network публичной страницы
не должно быть firebase-sdk.mjs, firestore.googleapis.com/Listen или запроса
media-variants.json. Подготовленные картинки имеют адрес /assets/optimized/.
Firebase остаётся в админке для входа и редактирования.

Каталог обновляется коротким запросом через Worker при загрузке страницы
и возвращении в её вкладку/окно (не чаще раза в 30 секунд). Серверный кеш —
15 секунд. При сбое запроса статическая страница остаётся доступна; успешная
пустая выдача отличается от ошибки. Постоянных Listen-соединений у посетителя
больше нет. Закрытые треки по-прежнему не выдаются медиа-сервисом.

Google-вход на домене: если auth/unauthorized-domain остаётся, добавьте
eduardshilov.com в Firebase Authentication → Settings → Authorized domains.
Не меняйте authDomain в settings.json и DNS ради этой ошибки.

Скорость реального домена и OAuth после установки проверяются у вас:
в облачной среде нет ваших учётных данных, а доступ к рабочим сервисам
ограничен. Локальные проверки используют тестовые медиа и сервисы.
