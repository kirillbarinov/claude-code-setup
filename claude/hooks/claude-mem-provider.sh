#!/bin/bash
# Канал наблюдателя claude-mem. Очередь предпочтений, сверху вниз:
#
#   1. claude-haiku-4-5 по подписке      — денег не стоит
#   2. бесплатные модели на OpenRouter   — не трогают недельный лимит подписки
#   3. deepseek/deepseek-v4-flash-0731   — платный хвост, $0.03/$0.32 за млн
#
# Переход 2->3 делает сам OpenRouter внутри одного запроса: список моделей в
# CLAUDE_MEM_OPENROUTER_MODEL уезжает в тело как models:[...]. Переход 1->2
# делать некому — МЕЖДУ ПРОВАЙДЕРАМИ фолбэка в claude-mem нет вовсе, настроек
# *_FALLBACK_PROVIDER в воркере не существует, канал всегда один. Когда
# подписка упирается в недельный лимит, воркер ставит кулдаун на 30 минут и
# долбится в ту же стену, пока окно не откроется. Так память и молчала
# 23–24 сентября 2026. Этот сторож и есть недостающий переход 1->2.
#
# Что делает. Раз в 10 минут (launchd) смотрит, жив ли текущий канал, и
# переключает CLAUDE_MEM_PROVIDER, перезапуская воркер:
#   подписка отказала    -> OpenRouter, вернуться попробуем через 1, 2, 4, 8, 12 ч
#   вернулись, снова лягла -> обратно на OpenRouter, срок ожидания растёт
#   отказал и OpenRouter -> пробуем подписку, не дожидаясь срока
#   мечется туда-сюда    -> останавливается и взводит memory-stalled.md
#
# Отказ канала определяется по observer-health.json (ошибки подряд ПОСЛЕ
# последнего переключения) и по quota-cooldown.json (кулдаун, взведённый после
# переключения). Старая запись кулдауна ни на что не влияет: пока к каналу нет
# запросов, снять её некому, и судить по ней нельзя.
#
#   claude-mem-provider.sh             — показать состояние
#   claude-mem-provider.sh tick        — один разбор (его зовёт launchd)
#   claude-mem-provider.sh claude      — прибить к подписке вручную
#   claude-mem-provider.sh openrouter  — прибить к цепочке вручную
#   claude-mem-provider.sh auto        — вернуть автоматику
#
# Прибитый вручную канал сторож не трогает: ручное решение сильнее.
# Состав цепочки моделей внутри OpenRouter задаёт соседний claude-mem-model.sh.
set -uo pipefail
PY=__PYTHON__
CMD="${1:-show}"

exec "$PY" - "$CMD" <<'PYEOF'
import json, os, sys, time, urllib.request, datetime

CMD = sys.argv[1]
HOME = os.path.expanduser('~')
SETTINGS = os.path.join(HOME, '.claude-mem', 'settings.json')
COOLDOWN = os.path.join(HOME, '.claude-mem', 'quota-cooldown.json')
HEALTH   = os.path.join(HOME, '.claude-mem', 'observer-health.json')
STATE    = os.path.join(HOME, '.claude', 'state', 'claude-mem-provider.json')
LOG      = os.path.join(HOME, '.claude', 'state', 'claude-mem-provider.log')
STALL    = os.path.join(HOME, '.claude', 'state', 'memory-stalled.md')

MINUTE = 60_000
# Подряд идущих ошибок, после которых канал считается упавшим.
PODRYAD = {'claude': 3, 'openrouter': 10}
# Сколько ждать перед возвратом на подписку: 1, 2, 4, 8, дальше по 12 часов.
OTKAT_CHASY = [1, 2, 4, 8, 12]
DERZHAT = 8 * MINUTE          # не переключать чаще, чем раз в 8 минут
METANIE_OKNO = 60 * MINUTE    # окно, в котором считаем метания
METANIE_PREDEL = 3            # столько переключений в окне — это метание


def chitat(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def pisat(path, data):
    tmp = f'{path}.{os.getpid()}.tmp'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def zapis(text):
    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 200_000:
            with open(LOG, encoding='utf-8') as f:
                hvost = f.readlines()[-500:]
            with open(LOG, 'w', encoding='utf-8') as f:
                f.writelines(hvost)
    except Exception:
        pass
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(f'{stamp}  {text}\n')
    print(text)


def kogda(ms):
    if not ms:
        return 'никогда'
    return datetime.datetime.fromtimestamp(ms / 1000).strftime('%d.%m %H:%M')


nastroiki = chitat(SETTINGS, {})
kanal = nastroiki.get('CLAUDE_MEM_PROVIDER', 'claude')
port = nastroiki.get('CLAUDE_MEM_WORKER_PORT', '37701')
sostoyanie = chitat(STATE, {})
rezhim = sostoyanie.get('rezhim', 'auto')
since = sostoyanie.get('since', 0)
sboev = sostoyanie.get('sboev', 0)
sled = sostoyanie.get('sleduyushchaya_popytka', 0)
perekl = sostoyanie.get('perekl', [])
seychas = int(time.time() * 1000)


def perezapusk():
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/api/admin/restart', data=b'', method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception as e:
        zapis(f'перезапуск воркера не удался: {e}')
        return False


def postavit(novyi, rezhim_novyi, prichina, sboev_novyi=None, sled_novyi=None):
    """Записать канал в настройки, перезапустить воркер, обновить состояние."""
    if novyi == 'openrouter':
        if not nastroiki.get('CLAUDE_MEM_OPENROUTER_API_KEY') \
                or not nastroiki.get('CLAUDE_MEM_OPENROUTER_MODEL'):
            zapis('НЕ переключаю на openrouter: нет ключа или цепочки моделей')
            return False
    nastroiki['CLAUDE_MEM_PROVIDER'] = novyi
    pisat(SETTINGS, nastroiki)
    ok = perezapusk()
    novye = [t for t in perekl if seychas - t < METANIE_OKNO] + [seychas]
    pisat(STATE, {
        'rezhim': rezhim_novyi,
        'kanal': novyi,
        'since': seychas,
        'sboev': sboev if sboev_novyi is None else sboev_novyi,
        'sleduyushchaya_popytka': sled if sled_novyi is None else sled_novyi,
        'perekl': novye,
    })
    zapis(f'{kanal} -> {novyi} ({prichina}); '
          f'воркер {"перезапущен" if ok else "НЕ перезапущен"}')
    return True


def otkat(n):
    chasy = OTKAT_CHASY[min(n, len(OTKAT_CHASY)) - 1] if n > 0 else OTKAT_CHASY[0]
    return seychas + chasy * 60 * MINUTE


# ---- ручные режимы -------------------------------------------------------
if CMD in ('claude', 'openrouter'):
    postavit(CMD, 'pinned', 'вручную', sboev_novyi=0, sled_novyi=0)
    sys.exit(0)

if CMD == 'auto':
    pisat(STATE, {'rezhim': 'auto', 'kanal': kanal, 'since': seychas,
                  'sboev': 0, 'sleduyushchaya_popytka': 0, 'perekl': []})
    zapis(f'автоматика включена, текущий канал {kanal}')
    sys.exit(0)

if CMD == 'show':
    zdorovye = chitat(HEALTH, {})
    kd = chitat(COOLDOWN, [])
    print(f'канал:             {kanal}')
    print(f'режим:             {rezhim}'
          + ('  (ручной канал сторож не трогает)' if rezhim == 'pinned' else ''))
    print(f'на этом канале с:  {kogda(since)}')
    print(f'подряд ошибок:     {zdorovye.get("consecutiveFailures", "?")}')
    print(f'успех / ошибка:    {kogda(zdorovye.get("lastSuccessAt"))} / '
          f'{kogda(zdorovye.get("lastErrorAt"))}')
    if kanal == 'openrouter' and sled:
        print(f'вернуться к подписке не раньше: {kogda(sled)} '
              f'(неудач подряд: {sboev})')
    for z in kd if isinstance(kd, list) else []:
        print(f'кулдаун:           {z.get("provider")} / {z.get("window")} '
              f'с {kogda(z.get("armedAtMs"))}')
    print(f'1. подписка:       {nastroiki.get("CLAUDE_MEM_MODEL", "")}')
    print(f'2-3. OpenRouter:   {nastroiki.get("CLAUDE_MEM_OPENROUTER_MODEL", "")}')
    sys.exit(0)

if CMD != 'tick':
    print(f'неизвестная команда: {CMD}')
    sys.exit(2)

# ---- разбор --------------------------------------------------------------
if rezhim in ('pinned', 'stuck'):
    sys.exit(0)

zdorovye = chitat(HEALTH, {})
oshibok = zdorovye.get('consecutiveFailures', 0) or 0
posl_oshibka = zdorovye.get('lastErrorAt', 0) or 0
posl_uspeh = zdorovye.get('lastSuccessAt', 0) or 0
kd = chitat(COOLDOWN, [])
kd = kd if isinstance(kd, list) else []


def slomalsya(imya):
    """Канал сломан, если беда случилась ПОСЛЕ того, как мы на него встали."""
    svezhiy_kulldaun = any(
        z.get('provider') == imya and (z.get('armedAtMs') or 0) > since for z in kd)
    mnogo_oshibok = posl_oshibka > since and oshibok >= PODRYAD.get(imya, 5)
    return svezhiy_kulldaun or mnogo_oshibok


# Метание: оба канала валятся, переключать дальше бессмысленно.
svezhie = [t for t in perekl if seychas - t < METANIE_OKNO]
if len(svezhie) >= METANIE_PREDEL and slomalsya(kanal):
    sostoyanie['rezhim'] = 'stuck'
    pisat(STATE, sostoyanie)
    prichina = zdorovye.get('lastErrorMessage', 'причина не записана')
    with open(STALL, 'w', encoding='utf-8') as f:
        f.write('# Память claude-mem не пишет\n\n')
        f.write(f'- последняя запись: {kogda(posl_uspeh)}\n')
        f.write(f'- причина: оба канала отказывают. {prichina}\n\n')
        f.write('Сторож переключил канал три раза за час и остановился, '
                'чтобы не метаться.\n')
        f.write('Разобраться и снять стопор: '
                '`~/.claude/hooks/claude-mem-provider.sh auto`.\n')
    zapis('оба канала отказывают, сторож остановлен (rezhim=stuck), '
          'взведён memory-stalled.md')
    sys.exit(0)

if seychas - since < DERZHAT:
    sys.exit(0)

if kanal == 'claude':
    if slomalsya('claude'):
        postavit('openrouter', 'auto',
                 f'подписка отказала (ошибок подряд {oshibok})',
                 sboev_novyi=sboev + 1, sled_novyi=otkat(sboev + 1))
    elif sboev and posl_uspeh > since + 2 * 60 * MINUTE:
        sostoyanie['sboev'] = 0
        pisat(STATE, sostoyanie)
        zapis('подписка держится больше двух часов, счётчик неудач сброшен')
    sys.exit(0)

if kanal == 'openrouter':
    if slomalsya('openrouter'):
        postavit('claude', 'auto',
                 f'запасной канал отказал (ошибок подряд {oshibok})')
    elif sled and seychas >= sled:
        postavit('claude', 'auto', 'срок вышел, пробуем подписку снова')
    sys.exit(0)
PYEOF
