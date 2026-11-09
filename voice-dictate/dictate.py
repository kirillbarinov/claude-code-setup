"""Голосовая диктовка: правый Option — старт/стоп записи, текст вставляется в активное окно.

Распознавание локально через mlx-whisper. Короткие записи — large-v3 (точнее),
длинные — large-v3-turbo (укладываемся в ~5 с).
"""
import os
import re
import subprocess
import sys
import threading
import time
import wave

import numpy as np
import AVFoundation
import mlx_whisper
import Quartz
from AppKit import NSApplication, NSApplicationActivationPolicyAccessory, NSPasteboard, NSPasteboardTypeString
from Foundation import NSURL

import overlay

SR = 16000
MODEL_ACCURATE = "mlx-community/whisper-large-v3-mlx"
MODEL_FAST = "mlx-community/whisper-large-v3-turbo"
FAST_AFTER_SEC = 40          # длиннее — используем turbo
MIN_SEC = 0.4                # короче — считаем случайным нажатием
RIGHT_OPTION_KEYCODE = 61
HERE = os.path.dirname(os.path.abspath(__file__))
VOCAB_FILE = os.path.join(HERE, "vocab.txt")
FIXES_FILE = os.path.join(HERE, "fixes.txt")
SAMPLES_DIR = os.path.join(HERE, "samples")
REC_FILE = os.path.join(HERE, ".rec.wav")
KEEP_SAMPLES = 100

SND_START = "/System/Library/Sounds/Tink.aiff"
SND_STOP = "/System/Library/Sounds/Pop.aiff"
SND_ERR = "/System/Library/Sounds/Basso.aiff"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def play(path):
    subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_prompt():
    # Словарь терминов подсказывает модели написание (FastAPI, а не «фаст апи»).
    try:
        with open(VOCAB_FILE, encoding="utf-8") as f:
            words = [w.strip() for w in f if w.strip() and not w.startswith("#")]
        return "Задача для Claude Code. " + ", ".join(words) + "."
    except FileNotFoundError:
        return "Задача для Claude Code."


def apply_fixes(text):
    # Детерминированные автозамены «услышал => надо» целыми словами, без учёта регистра.
    try:
        with open(FIXES_FILE, encoding="utf-8") as f:
            rules = [l.split("=>", 1) for l in f if "=>" in l and not l.startswith("#")]
    except FileNotFoundError:
        return text
    for wrong, right in rules:
        text = re.sub(r"(?<!\w)" + re.escape(wrong.strip()) + r"(?!\w)", right.strip(), text, flags=re.IGNORECASE)
    return text


class Recorder:
    """Запись через AVAudioRecorder в WAV 16 кГц моно.

    Не sounddevice/PortAudio: его stream.stop() на macOS ловит взаимную блокировку
    с аудиопотоком CoreAudio (startStopCallback) и вешает демон навсегда.
    start/stop вызываются из главного потока (колбэк event tap).
    """

    def __init__(self):
        self.r = None

    @property
    def active(self):
        return self.r is not None

    def start(self):
        settings = {
            AVFoundation.AVFormatIDKey: 1819304813,  # kAudioFormatLinearPCM
            AVFoundation.AVSampleRateKey: float(SR),
            AVFoundation.AVNumberOfChannelsKey: 1,
            AVFoundation.AVLinearPCMBitDepthKey: 16,
            AVFoundation.AVLinearPCMIsFloatKey: False,
            AVFoundation.AVLinearPCMIsBigEndianKey: False,
        }
        r, err = AVFoundation.AVAudioRecorder.alloc().initWithURL_settings_error_(
            NSURL.fileURLWithPath_(REC_FILE), settings, None)
        if r is None:
            raise RuntimeError(f"AVAudioRecorder: {err}")
        r.setMeteringEnabled_(True)
        if not r.record():
            raise RuntimeError("AVAudioRecorder.record() failed")
        self.r = r

    def level(self):
        r = self.r
        if r is None:
            return 0.0
        r.updateMeters()
        return 10 ** (r.averagePowerForChannel_(0) / 20)  # dB -> амплитуда

    def stop(self):
        r, self.r = self.r, None
        r.stop()
        with wave.open(REC_FILE) as w:
            data = w.readframes(w.getnframes())
        return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768


SPEECH_RMS = 0.006  # минимальная громкость 100-мс окна для речи (фон комнаты ~0.0015)
# Фразы, которые Whisper выдумывает на тишине (наследие субтитров в обучении).
PHANTOMS = re.compile(
    r"продолжение следует|субтитр|редактор|корректор|спасибо за просмотр|"
    r"подписывайтесь|ставьте лайк|dimatorzok|amara\.org",
    re.IGNORECASE,
)


def trim_silence(audio):
    win = SR // 10
    n = len(audio) // win
    if n == 0:
        return audio[:0]
    rms = np.sqrt((audio[: n * win].reshape(n, win) ** 2).mean(axis=1))
    floor = np.percentile(rms, 10)
    # Есть ли речь вообще — строгий порог (пустые записи не отдаём модели).
    if np.count_nonzero(rms > max(SPEECH_RMS, floor * 3)) < 2:
        return audio[:0]
    # Края — мягкий порог и 0.5 с запаса. Строгий порог тут резал тихий конец фразы
    # при шумном фоне (фон 0.02 → порог 0.08 → «продукт, можем закрывать…» терялось).
    voiced = np.nonzero(rms > max(SPEECH_RMS * 0.7, floor * 1.8))[0]
    start = max(voiced[0] - 5, 0) * win
    end = min(voiced[-1] + 6, n) * win
    return audio[start:end]


def split_on_silence(audio, max_sec=28, min_sec=15):
    # mlx-whisper теряет initial_prompt после первого 30-секундного окна,
    # поэтому режем сами по самому тихому месту и подаём словарь в каждый кусок.
    chunks, win = [], SR // 10
    while len(audio) > max_sec * SR:
        zone = audio[min_sec * SR:max_sec * SR]
        energy = np.convolve(zone ** 2, np.ones(win), mode="valid")
        cut = min_sec * SR + int(np.argmin(energy)) + win // 2
        chunks.append(audio[:cut])
        audio = audio[cut:]
    chunks.append(audio)
    return chunks


def transcribe(audio):
    dur = len(audio) / SR
    repo = MODEL_FAST if dur > FAST_AFTER_SEC else MODEL_ACCURATE
    prompt = load_prompt()
    t = time.time()
    parts = []
    for chunk in split_on_silence(audio):
        r = mlx_whisper.transcribe(
            chunk,
            path_or_hf_repo=repo,
            language="ru",
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        parts += [
            s["text"].strip() for s in r["segments"]
            if s.get("no_speech_prob", 0) < 0.6 and not PHANTOMS.search(s["text"])
        ]
    text = apply_fixes(" ".join(p for p in parts if p).strip())
    log(f"{dur:.1f}s audio -> {time.time() - t:.2f}s ({repo.split('/')[1]}): {text}")
    return text


def paste(text):
    pb = NSPasteboard.generalPasteboard()
    old = pb.stringForType_(NSPasteboardTypeString)
    pb.clearContents()
    pb.setString_forType_(text, NSPasteboardTypeString)
    src = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
    for down in (True, False):
        ev = Quartz.CGEventCreateKeyboardEvent(src, 9, down)  # 9 = V
        Quartz.CGEventSetFlags(ev, Quartz.kCGEventFlagMaskCommand)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    time.sleep(0.4)  # даём приложению забрать буфер, потом возвращаем старый
    if old is not None:
        pb.clearContents()
        pb.setString_forType_(old, NSPasteboardTypeString)


def save_sample(audio, text):
    # Локальный архив записей — для сравнения моделей на реальном голосе.
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    base = os.path.join(SAMPLES_DIR, time.strftime("%Y%m%d-%H%M%S"))
    with wave.open(base + ".wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    with open(base + ".txt", "w", encoding="utf-8") as f:
        f.write(text)
    wavs = sorted(f for f in os.listdir(SAMPLES_DIR) if f.endswith(".wav"))
    for old in wavs[:-KEEP_SAMPLES]:
        for ext in (".wav", ".txt"):
            try:
                os.remove(os.path.join(SAMPLES_DIR, old[:-4] + ext))
            except FileNotFoundError:
                pass


rec = Recorder()
busy = threading.Lock()


def finish(audio):
    try:
        audio = trim_silence(audio)
        if len(audio) / SR < MIN_SEC:
            log("silence or too short, skipped")
            return
        overlay.set_mode("busy")
        with busy:
            text = transcribe(audio)
            overlay.set_mode("idle")  # убираем плашку до вставки
            if text:
                paste(text + " ")
            save_sample(audio, text)
    except Exception as e:
        log("error:", repr(e))
        play(SND_ERR)
    finally:
        overlay.set_mode("idle")
        finishing.clear()


def rewarm():
    # После простоя первый прогон медленный (~3.5 с вместо ~1 с): греем модель, пока человек говорит.
    with busy:
        mlx_whisper.transcribe(np.zeros(SR, dtype=np.float32), path_or_hf_repo=MODEL_ACCURATE, language="ru")


finishing = threading.Event()


def toggle():
    if finishing.is_set():
        log("busy transcribing, press ignored")
        return
    if rec.active:
        finishing.set()
        try:
            audio = rec.stop()
        except Exception as e:
            log("stop error:", repr(e))
            play(SND_ERR)
            overlay.set_mode("idle")
            finishing.clear()
            return
        play(SND_STOP)
        threading.Thread(target=finish, args=(audio,), daemon=True).start()
    else:
        try:
            rec.start()
            overlay.set_mode("rec")
            threading.Thread(target=rewarm, daemon=True).start()
            play(SND_START)
            log("recording...")
        except Exception as e:
            log("mic error:", repr(e))
            play(SND_ERR)


# Правый Option «чистым» нажатием: нажали и отпустили, без других клавиш между.
state = {"down": False, "clean": False}


def tap_cb(proxy, etype, event, refcon):
    if etype in (Quartz.kCGEventTapDisabledByTimeout, Quartz.kCGEventTapDisabledByUserInput):
        Quartz.CGEventTapEnable(tap, True)
        return event
    if etype == Quartz.kCGEventFlagsChanged:
        code = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
        if code == RIGHT_OPTION_KEYCODE:
            pressed = bool(Quartz.CGEventGetFlags(event) & Quartz.kCGEventFlagMaskAlternate)
            if pressed:
                state["down"], state["clean"] = True, True
            elif state["down"]:
                state["down"] = False
                if state["clean"]:
                    toggle()
        else:
            state["clean"] = False
    elif etype == Quartz.kCGEventKeyDown:
        state["clean"] = False
    return event


def warmup():
    silence = np.zeros(SR, dtype=np.float32)
    for repo in (MODEL_ACCURATE, MODEL_FAST):
        mlx_whisper.transcribe(silence, path_or_hf_repo=repo, language="ru")
    log("models loaded")


def check_permissions():
    # Под launchd права выдаются самому python, не терминалу — пишем состояние в лог
    # и просим недостающее (система покажет запрос или добавит python в список Настроек).
    import AVFoundation
    mic = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(AVFoundation.AVMediaTypeAudio)
    listen = Quartz.CGPreflightListenEventAccess()
    post = Quartz.CGPreflightPostEventAccess()
    names = {0: "not asked", 1: "restricted", 2: "DENIED", 3: "ok"}
    log(f"permissions: microphone={names.get(mic, mic)} input_monitoring={'ok' if listen else 'MISSING'} "
        f"accessibility={'ok' if post else 'MISSING'} binary={os.path.realpath(sys.executable)}")
    if mic == 0:
        AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
            AVFoundation.AVMediaTypeAudio, lambda ok: log("microphone granted" if ok else "microphone DENIED"))
    if not listen:
        Quartz.CGRequestListenEventAccess()
    if not post:
        Quartz.CGRequestPostEventAccess()


if __name__ == "__main__":
    check_permissions()
    mask = Quartz.CGEventMaskBit(Quartz.kCGEventFlagsChanged) | Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown)
    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionListenOnly, mask, tap_cb, None,
    )
    if tap is None:
        log("Нет доступа к клавиатуре: дай Input Monitoring / Accessibility этому python в System Settings → Privacy & Security")
        sys.exit(1)
    threading.Thread(target=warmup, daemon=True).start()
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)  # без иконки в Dock
    ov = overlay.Overlay.alloc().init()
    overlay.level_source = rec.level
    loop_src = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    Quartz.CFRunLoopAddSource(Quartz.CFRunLoopGetMain(), loop_src, Quartz.kCFRunLoopCommonModes)
    Quartz.CGEventTapEnable(tap, True)
    log("ready: tap Right Option to start/stop")
    app.run()
