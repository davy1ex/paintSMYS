# Hello World

Минимальный локальный плагин paintSMYS: команда **Hello World** добавляет на Artboard цветной прямоугольник и текст `Hello from paintSMYS!`. Это обычные редактируемые объекты; вся композиция добавляется одним действием, поэтому Undo убирает оба объекта, а Redo возвращает их.

## Файлы

- `manifest.json` описывает плагин и команду, которую paintSMYS покажет в меню Plugins.
- `index.js` регистрирует команду и создаёт объекты через Plugin API v0.
- `README.md` содержит эту инструкцию.

Для запуска нужны только `manifest.json` и `index.js`. Плагин не требует npm, Node.js, сборки, сетевого доступа или сторонних файлов.

## Установка

1. Закрой paintSMYS.
2. Скопируй всю папку `hello-world` в каталог `<app.getPath('userData')>/plugins/`, чтобы файлы оказались в `plugins/hello-world/manifest.json` и `plugins/hello-world/index.js`.
3. Запусти или перезапусти paintSMYS и создай новый проект.
4. Открой **Plugins → Hello World**.

Для запуска из исходников текущие каталоги такие: Windows — `%APPDATA%\paint-smys\plugins\`, Linux — `~/.config/paint-smys/plugins/`, macOS — `~/Library/Application Support/paint-smys/plugins/`. В другой сборке базовый путь может отличаться; его задаёт Electron `app.getPath('userData')`.

После запуска выбери **Select / Move** и нажми на прямоугольник или текст, чтобы увидеть свойства объекта. Затем попробуй **Edit → Undo** и **Edit → Redo**.

## Изменить плагин

Открой `index.js` в обычном текстовом редакторе:

- В строке 12 `const fill = '#2f6fed'` задаёт заливку прямоугольника. Замени значение, например, на `'#e85d75'`.
- В строке 13 `const message = 'Hello from paintSMYS!'` задаёт текст.
- Строки 8–11 выбирают размер прямоугольника и центрируют его относительно Artboard. Измени расчёт `x` или `y`, чтобы передвинуть композицию.
- В объекте Rectangle (строки 17–24) свойства `stroke` и `strokeWidth` задают цвет и толщину обводки.
- В объекте Text (строки 27–34) свойства `x`, `y`, `fontSize` и `color` задают положение, размер шрифта и его цвет.

Чтобы добавить команду, сначала добавь ещё один элемент в массив `commands` в `manifest.json`, например `{ "id": "add-another-shape", "name": "Add Another Shape" }`. Затем в `index.js` вызови `api.registerCommand('add-another-shape', async (host) => { ... })` внутри `activate`, как уже сделано для `create-hello-world`. Каждый зарегистрированный ID должен совпадать с ID в манифесте.

После изменения файлов перезапусти paintSMYS. Подробнее о формате объектов и действующем контракте: [Plugin API v0](../../../docs/PLUGIN_API_V0.md).

Устанавливай сторонние плагины только из источников, которым доверяешь.
