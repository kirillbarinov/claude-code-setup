#!/usr/bin/env python3
"""Детерминированный валидатор отчёта researcher'а (воронка v2). Сети не трогает, стоит ноль.

Ловит структурный брак, который до сих пор ловился только глазами:
цифру без источника, утверждение без числа независимых источников,
отсутствующие обязательные секции, пустое «Кто не согласен», дату из будущего,
следы синтеза Perplexity в «Обосновании».

Не проверяет истинность фактов — только форму, в которой они поданы.
Форма — необходимое условие: отчёт, где цифра стоит без URL, нельзя проверить
даже вручную.

Запуск:  python3 ~/.claude/hooks/validate-research-report.py отчёт.md [--today YYYY-MM-DD]
Выход:   0 — годен; 1 — есть ОШИБКИ (отправлять нельзя); предупреждения не валят.
"""
import re
import sys
from datetime import date, datetime

SECTIONS = ["Вывод", "Обоснование", "Кто не согласен", "Не установлено", "Покрытие"]
MANDATORY = SECTIONS

# Число независимых источников при утверждении: «[3 незав.]», «[1 незав]», «[2 независимых]»
INDEP = re.compile(r"\[\d+\s*незав(?:\.|ис\w*)?\]", re.I)
URL = re.compile(r"https?://\S+")
DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
SRC_DATE = re.compile(r"\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b")
QUOTE = re.compile(r"Дословно\s*:")
# Число, которое выглядит как утверждаемая величина: цена, лимит, версия, доля.
FIGURE = re.compile(r"\d[\d\s .,]*\s*(?:[₽$€%]|руб|USD|EUR|КБ|МБ|ГБ|ТБ|млн|млрд|тыс"
                    r"|за\s|/\s*(?:мес|год|1|млн|тыс)|GB|MB|TB|req|мин|сек)", re.I)
SYNTH = re.compile(r"по данным Perplexity|согласно синтезу|по результатам поиска"
                   r"|как сообщает поиск|источник не открывал", re.I)


def split_sections(text):
    out, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^\s*#{1,3}\s+(.+?)\s*$", line)
        if m and m.group(1).strip() in SECTIONS:
            cur = m.group(1).strip()
            out[cur] = []
        elif cur:
            out[cur].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def bullets(body):
    """Буллеты верхнего уровня вместе с их отступными продолжениями."""
    items, cur = [], None
    for line in body.splitlines():
        if re.match(r"^\s{0,1}[-*]\s+", line):
            if cur is not None:
                items.append(cur)
            cur = line
        elif cur is not None and line.strip():
            cur += "\n" + line
    if cur is not None:
        items.append(cur)
    return items


def main():
    args = [a for a in sys.argv[1:]]
    today = date.today()
    if "--today" in args:
        i = args.index("--today")
        today = datetime.strptime(args[i + 1], "%Y-%m-%d").date()
        del args[i:i + 2]
    if not args:
        print("нужен путь к файлу отчёта", file=sys.stderr)
        return 2

    text = open(args[0], encoding="utf-8").read()
    sec = split_sections(text)
    errors, warns = [], []

    for name in MANDATORY:
        if name not in sec:
            errors.append(f"нет обязательной секции «{name}»")
        elif not sec[name].strip():
            errors.append(f"секция «{name}» пуста — пустой результат тоже пишется словами")

    obosn = sec.get("Обоснование", "")
    for b in bullets(obosn):
        head = b.splitlines()[0][:70]
        if not INDEP.search(b):
            errors.append(f"в «Обосновании» буллет без числа независимых источников "
                          f"(формат [N незав.]): {head}…")
        if not URL.search(b):
            errors.append(f"в «Обосновании» буллет без URL источника: {head}…")
        if not SRC_DATE.search(b):
            errors.append(f"в «Обосновании» буллет без даты источника — "
                          f"датировать источником, не сегодняшним днём: {head}…")
        if FIGURE.search(b) and not QUOTE.search(b):
            warns.append(f"цифра без строки «Дословно:» — "
                         f"пересказ теряет квалификатор: {head}…")

    if SYNTH.search(obosn):
        errors.append("в «Обосновании» след синтеза («по данным Perplexity» и т. п.) — "
                      "синтез это обнаружение, в обоснование идут только открытые страницы")

    dis = sec.get("Кто не согласен", "")
    if dis.strip() and len(dis.strip()) < 40:
        errors.append("«Кто не согласен» — заглушка; либо кто и почему не согласен, "
                      "либо «разногласий не обнаружено» + где искал")
    if re.search(r"^\s*[-*]?\s*(нет|—|-)\s*$", dis.strip(), re.M | re.I):
        errors.append("«Кто не согласен» отписка «нет» — несогласие фиксируется, "
                      "поиск разногласий пропускать нельзя")

    cov = sec.get("Покрытие", "")
    if cov:
        if not re.search(r"\d+\s*вызов", cov, re.I):
            warns.append("в «Покрытии» не названо число вызовов Perplexity")
        if not re.search(r"канал", cov, re.I):
            warns.append("в «Покрытии» не названы каналы (задействованные и нет)")
        if not re.search(r"язык|languages?|en\b|ru\b", cov, re.I):
            warns.append("в «Покрытии» не названы языки поиска (правило родных языков)")
        if not re.search(r"контрзапрос|опроверж|debunk|wrong|myth|criticism", cov, re.I):
            warns.append("в «Покрытии» нет формулировок контрзапроса "
                         "по решающему утверждению")
        if not re.search(r"страниц|открыт", cov, re.I):
            warns.append("в «Покрытии» не названо число открытых страниц")

    for m in DATE.finditer(text):
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
        if d > today:
            line = text[:m.start()].count("\n") + 1
            ctx = text.splitlines()[line - 1].strip()[:60]
            if not re.search(r"перепроверить|до\s|until|EOL|истека", ctx, re.I):
                warns.append(f"дата в будущем ({d}) вне поля «Перепроверить после»: {ctx}…")

    for e in errors:
        print(f"ОШИБКА  {e}")
    for w in warns:
        print(f"внимание {w}")
    print(f"\nИТОГ: ошибок={len(errors)} предупреждений={len(warns)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
