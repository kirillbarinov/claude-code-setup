"""Плавающая плашка-индикатор: волна + таймер во время записи, спиннер во время распознавания.

Другие потоки только пишут в `ui`; окно читает его по таймеру в главном потоке.
"""
import math
import time
from collections import deque

import objc
from AppKit import (
    NSBackingStoreBuffered, NSBezierPath, NSColor, NSFont, NSFontAttributeName,
    NSFontWeightMedium, NSForegroundColorAttributeName, NSMakeRect, NSPanel,
    NSScreen, NSStatusWindowLevel, NSString, NSView, NSWindowCollectionBehaviorFullScreenAuxiliary,
    NSWindowCollectionBehaviorIgnoresCycle, NSWindowCollectionBehaviorMoveToActiveSpace,
    NSWindowStyleMaskBorderless, NSWindowStyleMaskNonactivatingPanel,
)
from Foundation import NSObject, NSTimer

W, H = 210, 44
BARS = 14
FPS = 30

ui = {"mode": "idle", "t0": 0.0, "level": 0.0}   # mode: idle | rec | busy
levels = deque([0.0] * BARS, maxlen=BARS)
level_source = None  # функция -> текущая амплитуда микрофона (вызывается в главном потоке)


def set_mode(mode):
    if mode == "rec":
        ui["t0"] = time.time()
        levels.extend([0.0] * BARS)
    ui["mode"] = mode


def push_level(rms):
    # Речь в микрофон ~0.02–0.1 RMS; корень растягивает тихие значения.
    ui["level"] = max(ui["level"], min(1.0, math.sqrt(rms / 0.08)))


def _text(s, x, y, size, alpha=1.0):
    attrs = {
        NSFontAttributeName: NSFont.monospacedDigitSystemFontOfSize_weight_(size, NSFontWeightMedium),
        NSForegroundColorAttributeName: NSColor.colorWithWhite_alpha_(1.0, alpha),
    }
    NSString.stringWithString_(s).drawAtPoint_withAttributes_((x, y), attrs)


class OverlayView(NSView):
    def drawRect_(self, rect):
        now = time.time()
        bg = NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(self.bounds(), H / 2, H / 2)
        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.08, 0.08, 0.10, 0.9).setFill()
        bg.fill()

        if ui["mode"] == "rec":
            pulse = 0.7 + 0.3 * math.sin(now * 5)
            NSColor.colorWithCalibratedRed_green_blue_alpha_(1.0, 0.27, 0.23, pulse).setFill()
            NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(18, H / 2 - 5, 10, 10)).fill()

            NSColor.colorWithWhite_alpha_(0.92, 1.0).setFill()
            for i, lv in enumerate(levels):
                bh = 3 + lv * 24
                bar = NSMakeRect(40 + i * 7, (H - bh) / 2, 4, bh)
                NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(bar, 2, 2).fill()

            el = int(now - ui["t0"])
            _text(f"{el // 60}:{el % 60:02d}", W - 52, H / 2 - 8, 13, 0.85)
        else:
            # Спиннер: дуга 270°, вращается.
            cx, cy, r = 24, H / 2, 7
            start = -(now * 360) % 360
            arc = NSBezierPath.bezierPath()
            arc.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_((cx, cy), r, start, start + 270)
            arc.setLineWidth_(2.2)
            NSColor.colorWithWhite_alpha_(0.92, 1.0).setStroke()
            arc.stroke()
            _text("распознаю…", 42, H / 2 - 8, 13, 0.85)


class Overlay(NSObject):
    def init(self):
        self = objc.super(Overlay, self).init()
        self.build_panel()
        self.shown = False
        self.frame = 0
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            1.0 / FPS, self, "tick:", None, True)
        return self

    @objc.python_method
    def build_panel(self):
        self.panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(0, 0, W, H),
            NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel,
            NSBackingStoreBuffered, False,
        )
        p = self.panel
        p.setLevel_(NSStatusWindowLevel)
        p.setOpaque_(False)
        p.setBackgroundColor_(NSColor.clearColor())
        p.setHasShadow_(True)
        p.setIgnoresMouseEvents_(True)
        p.setHidesOnDeactivate_(False)
        # Не CanJoinAllSpaces: после полноэкранного Space окно с ним «залипало» на чужом
        # столе (isOnActiveSpace=False) — плашка рисовалась, но её не было видно нигде.
        p.setCollectionBehavior_(
            NSWindowCollectionBehaviorMoveToActiveSpace
            | NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehaviorIgnoresCycle
        )
        self.view = OverlayView.alloc().initWithFrame_(NSMakeRect(0, 0, W, H))
        p.setContentView_(self.view)

    @objc.python_method
    def show(self):
        # Экран, где сейчас активное окно (там, куда вставим текст).
        vf = NSScreen.mainScreen().visibleFrame()
        self.panel.setFrameOrigin_((vf.origin.x + (vf.size.width - W) / 2, vf.origin.y + 60))
        self.panel.orderFrontRegardless()

    @objc.python_method
    def ensure_on_active_space(self):
        # Человек мог переключить стол во время записи — переносим плашку следом.
        if self.panel.isOnActiveSpace():
            return
        self.panel.orderOut_(None)
        self.show()
        if not self.panel.isOnActiveSpace():
            print(time.strftime("%H:%M:%S"), "overlay off active space, rebuilding panel", flush=True)
            self.panel.close()
            self.build_panel()
            self.show()

    def tick_(self, timer):
        mode = ui["mode"]
        if mode == "idle":
            if self.shown:
                self.panel.orderOut_(None)
                self.shown = False
            return
        if not self.shown:
            self.show()
            self.shown = True
        self.frame += 1
        if self.frame % 10 == 0:
            self.ensure_on_active_space()
        if mode == "rec" and level_source is not None:
            push_level(level_source())
        if mode == "rec" and self.frame % 2 == 0:   # новая полоска ~15 раз в секунду
            levels.append(ui["level"])
            ui["level"] = 0.0
        self.view.setNeedsDisplay_(True)
