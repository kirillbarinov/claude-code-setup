# rules/ — модульная версия CLAUDE.md

Те же правила, что в `claude/CLAUDE.md`, но разбитые на отдельные файлы — чтобы подключать выборочно.

| Файл | Правило |
|---|---|
| `confidence.md` | Правило 95% уверенности перед изменениями |
| `perplexity.md` | Весь веб-поиск через Perplexity MCP (модели, recency, экономия) |
| `context7.md` | Когда проактивно брать доки библиотек через Context7 |
| `skills.md` | Проактивный вызов скиллов без слэш-команд |
| `web-test.md` | Авто-запуск браузерного smoke-теста после правок фронта |
| `subagents.md` | Субагенты для exploration/research |
| `web-fetching.md` | Чтение URL только через `ezycopy` |

## Как подключить

Скопируй нужные файлы в `~/.claude/rules/` — Claude Code подхватывает их автоматически:

```bash
mkdir -p ~/.claude/rules
cp claude/rules/perplexity.md claude/rules/context7.md ~/.claude/rules/
```

⚠️ **Не подключай rules/ вместе с полным CLAUDE.md из этого репо** — правила задублируются в контексте. Либо CLAUDE.md целиком (так ставит инсталлятор), либо выборочно rules/ + свой укороченный CLAUDE.md.
