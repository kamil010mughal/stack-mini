import argparse
import logging
import math
import random
import threading
import time
from dataclasses import dataclass
from typing import Optional

try:
    import pyperclip  # type: ignore
except Exception:  # pragma: no cover
    pyperclip = None  # type: ignore

try:
    from pynput import keyboard as pynput_keyboard  # type: ignore
    from pynput import mouse as pynput_mouse  # type: ignore
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "pynput is required. Install dependencies and run again: pip install -r requirements.txt"
    ) from exc


@dataclass
class SimulatorConfig:
    min_edit_interval_sec: float = 60.0
    max_edit_interval_sec: float = 120.0
    swirl_interval_sec: float = 300.0
    swirl_radius_px: int = 50
    swirl_duration_sec: float = 1.8
    min_chars_to_select: int = 3
    max_chars_to_select: int = 20
    max_clipboard_chars: int = 1000
    typing_delay_min_sec: float = 0.01
    typing_delay_max_sec: float = 0.035
    preserve_clipboard: bool = True
    selection_strategy: str = "mixed"  # one of: mixed, words, chars, line
    micro_edits_per_cycle_min: int = 1
    micro_edits_per_cycle_max: int = 3
    dry_run: bool = False
    duration_minutes: Optional[float] = None


class ActivitySimulator:
    def __init__(self, config: SimulatorConfig) -> None:
        self.config = config
        self.kb = pynput_keyboard.Controller()
        self.mouse = pynput_mouse.Controller()
        self._stop_event = threading.Event()
        self._swirl_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        logging.info("Starting activity simulator")
        self._swirl_thread = threading.Thread(target=self._swirl_worker, name="swirl-worker", daemon=True)
        self._swirl_thread.start()

        end_time: Optional[float] = None
        if self.config.duration_minutes is not None:
            end_time = time.time() + (self.config.duration_minutes * 60.0)

        try:
            while not self._stop_event.is_set():
                if end_time is not None and time.time() >= end_time:
                    logging.info("Duration reached; stopping")
                    break
                self._perform_edit_cycle()
                sleep_for = random.uniform(self.config.min_edit_interval_sec, self.config.max_edit_interval_sec)
                logging.debug("Sleeping %.1fs before next cycle", sleep_for)
                self._sleep_with_stop(sleep_for)
        except KeyboardInterrupt:
            logging.info("Interrupted by user")
        finally:
            self.stop()

    def stop(self) -> None:
        self._stop_event.set()
        if self._swirl_thread and self._swirl_thread.is_alive():
            self._swirl_thread.join(timeout=2.0)
        logging.info("Activity simulator stopped")

    def _sleep_with_stop(self, seconds: float) -> None:
        deadline = time.time() + seconds
        while not self._stop_event.is_set() and time.time() < deadline:
            time.sleep(0.1)

    def _swirl_worker(self) -> None:
        while not self._stop_event.is_set():
            interval = self._jittered_swirl_interval()
            logging.debug("Next swirl in %.1fs", interval)
            self._sleep_with_stop(interval)
            if self._stop_event.is_set():
                break
            self._perform_mouse_swirl()

    def _jittered_swirl_interval(self) -> float:
        base = self.config.swirl_interval_sec
        # ±10% jitter to avoid exact periodicity
        return base * random.uniform(0.9, 1.1)

    def _perform_mouse_swirl(self) -> None:
        if self.config.dry_run:
            logging.info("[dry-run] Would perform mouse swirl")
            return
        origin_x, origin_y = self.mouse.position
        logging.debug("Swirl origin at (%d, %d)", origin_x, origin_y)
        steps = max(12, int(self.config.swirl_duration_sec * 60))
        for i in range(steps):
            if self._stop_event.is_set():
                break
            angle = (2.0 * math.pi) * (i / steps)
            dx = int(self.config.swirl_radius_px * math.cos(angle))
            dy = int(self.config.swirl_radius_px * math.sin(angle))
            self.mouse.position = (origin_x + dx, origin_y + dy)
            time.sleep(self.config.swirl_duration_sec / steps)
        # Return to origin to avoid cursor drift
        self.mouse.position = (origin_x, origin_y)
        logging.debug("Mouse swirl completed")

    def _perform_edit_cycle(self) -> None:
        edits = random.randint(self.config.micro_edits_per_cycle_min, self.config.micro_edits_per_cycle_max)
        logging.info("Starting edit cycle with %d micro-edit(s)", edits)
        for idx in range(edits):
            if self._stop_event.is_set():
                return
            logging.debug("Micro-edit %d/%d", idx + 1, edits)
            self._micro_edit()
            # brief human-like pause between micro-edits
            self._sleep_with_stop(random.uniform(0.5, 1.2))
            self._slight_mouse_jitter()

    def _micro_edit(self) -> None:
        # Move the caret to a nearby location first
        self._move_caret_randomly()

        if self.config.dry_run:
            logging.info("[dry-run] Would select, copy, delete, and re-type selection")
            return

        previous_clipboard: Optional[str] = None
        if self.config.preserve_clipboard and pyperclip is not None:
            try:
                previous_clipboard = pyperclip.paste()
            except Exception:
                previous_clipboard = None

        try:
            selected_text = self._attempt_selection_and_copy()
            if not selected_text:
                logging.debug("No selection captured; skipping micro-edit")
                self._press_key(pynput_keyboard.Key.right)  # clear selection if any
                return

            if len(selected_text) > self.config.max_clipboard_chars:
                logging.debug("Selection too large (%d chars); skipping", len(selected_text))
                self._press_key(pynput_keyboard.Key.right)
                return

            # Delete selection
            self._press_key(pynput_keyboard.Key.backspace)
            time.sleep(random.uniform(0.1, 0.25))

            # Re-type the exact same text character by character
            self._type_text_human_like(selected_text)
        finally:
            if self.config.preserve_clipboard and pyperclip is not None and previous_clipboard is not None:
                try:
                    pyperclip.copy(previous_clipboard)
                except Exception:
                    pass

    def _attempt_selection_and_copy(self) -> Optional[str]:
        # Try up to three selection strategies to get a non-empty, reasonably sized selection
        strategies = self._selection_order()
        for strategy in strategies:
            if self._stop_event.is_set():
                return None
            self._apply_selection_strategy(strategy)
            time.sleep(0.1)
            # Copy to clipboard
            with self._pressed(pynput_keyboard.Key.ctrl):
                self._tap_char('c')
            time.sleep(0.08)
            text = None
            if pyperclip is not None:
                try:
                    text = pyperclip.paste()
                except Exception:
                    text = None
            if text:
                return text
            # Clear selection and try another way
            self._press_key(pynput_keyboard.Key.right)
            time.sleep(0.05)
        return None

    def _selection_order(self) -> list[str]:
        mode = self.config.selection_strategy
        if mode == "words":
            return ["words"]
        if mode == "chars":
            return ["chars"]
        if mode == "line":
            return ["line"]
        # mixed
        choices = ["words", "chars", "line"]
        random.shuffle(choices)
        return choices

    def _apply_selection_strategy(self, strategy: str) -> None:
        if strategy == "words":
            words = random.randint(1, max(1, self.config.max_chars_to_select // 5))
            with self._pressed(pynput_keyboard.Key.shift, pynput_keyboard.Key.ctrl):
                for _ in range(words):
                    self._press_key(pynput_keyboard.Key.right)
        elif strategy == "chars":
            chars = random.randint(self.config.min_chars_to_select, self.config.max_chars_to_select)
            with self._pressed(pynput_keyboard.Key.shift):
                for _ in range(chars):
                    self._press_key(pynput_keyboard.Key.right)
        else:  # line
            self._press_key(pynput_keyboard.Key.home)
            with self._pressed(pynput_keyboard.Key.shift):
                self._press_key(pynput_keyboard.Key.end)

    def _type_text_human_like(self, text: str) -> None:
        for ch in text:
            self.kb.type(ch)
            time.sleep(random.uniform(self.config.typing_delay_min_sec, self.config.typing_delay_max_sec))

    def _move_caret_randomly(self) -> None:
        # Small random cursor moves to emulate navigation
        vertical_moves = random.randint(0, 3)
        horizontal_moves = random.randint(0, 8)
        for _ in range(vertical_moves):
            self._press_key(random.choice([pynput_keyboard.Key.up, pynput_keyboard.Key.down]))
            time.sleep(0.02)
        for _ in range(horizontal_moves):
            self._press_key(random.choice([pynput_keyboard.Key.left, pynput_keyboard.Key.right]))
            time.sleep(0.01)
        if random.random() < 0.25:
            self._press_key(random.choice([pynput_keyboard.Key.home, pynput_keyboard.Key.end]))

    def _slight_mouse_jitter(self) -> None:
        if self.config.dry_run:
            logging.info("[dry-run] Would jitter mouse slightly")
            return
        dx = random.randint(-3, 3)
        dy = random.randint(-3, 3)
        if dx == 0 and dy == 0:
            dy = 1
        x, y = self.mouse.position
        self.mouse.position = (x + dx, y + dy)

    def _press_key(self, key: pynput_keyboard.Key) -> None:
        self.kb.press(key)
        self.kb.release(key)

    def _tap_char(self, ch: str) -> None:
        self.kb.press(ch)
        self.kb.release(ch)

    from contextlib import contextmanager

    @contextmanager
    def _pressed(self, *keys: pynput_keyboard.Key):
        try:
            for k in keys:
                self.kb.press(k)
            yield
        finally:
            for k in reversed(keys):
                self.kb.release(k)


def parse_args() -> SimulatorConfig:
    parser = argparse.ArgumentParser(
        description=(
            "Simulate light code editing and periodic mouse movement in the currently focused editor window."
        )
    )
    parser.add_argument("--min-edit-interval", type=float, default=60.0, help="Minimum seconds between edit cycles")
    parser.add_argument("--max-edit-interval", type=float, default=120.0, help="Maximum seconds between edit cycles")
    parser.add_argument("--swirl-interval-minutes", type=float, default=5.0, help="Minutes between mouse swirl")
    parser.add_argument("--swirl-radius", type=int, default=50, help="Mouse swirl radius in pixels")
    parser.add_argument("--swirl-duration", type=float, default=1.8, help="Mouse swirl duration in seconds")
    parser.add_argument("--selection", choices=["mixed", "words", "chars", "line"], default="mixed", help="Selection strategy")
    parser.add_argument("--min-chars", type=int, default=3, help="Minimum chars to select when using char strategy")
    parser.add_argument("--max-chars", type=int, default=20, help="Maximum chars to select when using char strategy")
    parser.add_argument("--max-clipboard", type=int, default=1000, help="Maximum allowed selection length in characters")
    parser.add_argument("--typing-min", type=float, default=0.01, help="Minimum per-character typing delay (s)")
    parser.add_argument("--typing-max", type=float, default=0.035, help="Maximum per-character typing delay (s)")
    parser.add_argument("--micro-edits-min", type=int, default=1, help="Min micro-edits per cycle")
    parser.add_argument("--micro-edits-max", type=int, default=3, help="Max micro-edits per cycle")
    parser.add_argument("--preserve-clipboard", action="store_true", help="Restore original clipboard after each micro-edit")
    parser.add_argument("--no-preserve-clipboard", dest="preserve_clipboard", action="store_false", help="Do not restore clipboard")
    parser.set_defaults(preserve_clipboard=True)
    parser.add_argument("--dry-run", action="store_true", help="Do not send inputs; log intended actions")
    parser.add_argument("--duration-minutes", type=float, default=None, help="Auto-stop after N minutes")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="Logging level")

    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    return SimulatorConfig(
        min_edit_interval_sec=float(args.min_edit_interval),
        max_edit_interval_sec=float(args.max_edit_interval),
        swirl_interval_sec=float(args.swirl_interval_minutes) * 60.0,
        swirl_radius_px=int(args.swirl_radius),
        swirl_duration_sec=float(args.swirl_duration),
        min_chars_to_select=int(args.min_chars),
        max_chars_to_select=int(args.max_chars),
        max_clipboard_chars=int(args.max_clipboard),
        typing_delay_min_sec=float(args.typing_min),
        typing_delay_max_sec=float(args.typing_max),
        preserve_clipboard=bool(args.preserve_clipboard),
        selection_strategy=str(args.selection),
        micro_edits_per_cycle_min=int(args.micro_edits_min),
        micro_edits_per_cycle_max=int(args.micro_edits_max),
        dry_run=bool(args.dry_run),
        duration_minutes=(float(args.duration_minutes) if args.duration_minutes is not None else None),
    )


def main() -> None:
    cfg = parse_args()
    if cfg.typing_delay_min_sec > cfg.typing_delay_max_sec:
        cfg.typing_delay_min_sec, cfg.typing_delay_max_sec = (
            cfg.typing_delay_max_sec,
            cfg.typing_delay_min_sec,
        )
    if cfg.min_edit_interval_sec > cfg.max_edit_interval_sec:
        cfg.min_edit_interval_sec, cfg.max_edit_interval_sec = (
            cfg.max_edit_interval_sec,
            cfg.min_edit_interval_sec,
        )
    sim = ActivitySimulator(cfg)
    sim.start()


if __name__ == "__main__":
    main()
