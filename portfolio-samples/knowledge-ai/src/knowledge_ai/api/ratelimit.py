"""In-process rate limiting for a public demo.

Three limits, all configurable (``KAI_RATE_LIMIT_PER_MINUTE``,
``KAI_PER_IP_DAILY_CAP``, ``KAI_DAILY_CAP``):

* per-IP sliding window per minute (stops a single client hammering the API)
* per-IP daily cap
* global daily cap across all clients (bounds the worst-case LLM bill)

Daily counters reset at local midnight (``KAI_TIMEZONE``, default Asia/Tokyo).
State lives in memory, so limits are per process: run one worker for the demo,
or move the counters to Redis when scaling out (same interface).
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

_MAX_TRACKED_IPS = 10_000


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after: int = 0  # seconds
    reason: str | None = None  # "minute" | "ip_daily" | "daily"


class RateLimiter:
    def __init__(
        self,
        per_minute: int,
        per_ip_daily: int,
        daily_cap: int,
        timezone: str = "Asia/Tokyo",
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.per_minute = per_minute
        self.per_ip_daily = per_ip_daily
        self.daily_cap = daily_cap
        self.tz = ZoneInfo(timezone)
        self.clock = clock
        self._lock = threading.Lock()
        self._windows: dict[str, deque[float]] = {}
        self._ip_day: dict[str, int] = {}
        self._day_total = 0
        self._day_key = ""

    def _today(self, now: float) -> str:
        return datetime.fromtimestamp(now, self.tz).strftime("%Y-%m-%d")

    def _seconds_to_midnight(self, now: float) -> int:
        dt = datetime.fromtimestamp(now, self.tz)
        return max(1, 86400 - (dt.hour * 3600 + dt.minute * 60 + dt.second))

    def check(self, ip: str) -> Decision:
        now = self.clock()
        with self._lock:
            day = self._today(now)
            if day != self._day_key:
                self._day_key, self._day_total = day, 0
                self._ip_day.clear()
            if self.daily_cap > 0 and self._day_total >= self.daily_cap:
                return Decision(False, self._seconds_to_midnight(now), "daily")
            if self.per_ip_daily > 0 and self._ip_day.get(ip, 0) >= self.per_ip_daily:
                return Decision(False, self._seconds_to_midnight(now), "ip_daily")
            window = self._windows.setdefault(ip, deque())
            while window and now - window[0] >= 60:
                window.popleft()
            if self.per_minute > 0 and len(window) >= self.per_minute:
                return Decision(False, max(1, int(60 - (now - window[0])) + 1), "minute")
            window.append(now)
            self._ip_day[ip] = self._ip_day.get(ip, 0) + 1
            self._day_total += 1
            if len(self._windows) > _MAX_TRACKED_IPS:
                self._windows = {k: v for k, v in self._windows.items() if v}
            return Decision(True)

    @property
    def used_today(self) -> int:
        return self._day_total
