"""In-process rate limiting for a public demo.

Three limits, all configurable (``KAI_RATE_LIMIT_PER_MINUTE``,
``KAI_PER_IP_DAILY_CAP``, ``KAI_DAILY_CAP``):

* per-IP sliding window per minute (stops a single client hammering the API)
* per-IP daily cap
* global daily cap across all clients (bounds the worst-case LLM bill)

Daily counters reset at local midnight (``KAI_TIMEZONE``, default Asia/Tokyo).
State lives in memory, so limits are per process: run one worker for the demo,
or move the counters to Redis when scaling out (same interface).

Memory stays bounded: per-minute windows are kept for at most ``_MAX_TRACKED_IPS``
addresses (least recently seen are forgotten first), and per-IP daily counts
exist only for allowed requests, so the global daily cap bounds them. For that
reason a per-IP daily cap requires a positive global daily cap (checked at start).
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
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
        if per_ip_daily > 0 and daily_cap <= 0:
            # IP ごとの日次件数は許可したリクエストの分だけ記録するので、全体の上限がその数の上限になる。
            # 全体の上限がないと、IP を変えながら来るアクセスで記録が0時まで増え続ける
            raise ValueError(
                "KAI_PER_IP_DAILY_CAP needs a positive KAI_DAILY_CAP (it bounds the per-IP daily records)"
            )
        self.per_minute = per_minute
        self.per_ip_daily = per_ip_daily
        self.daily_cap = daily_cap
        self.tz = ZoneInfo(timezone)
        self.clock = clock
        self._lock = threading.Lock()
        # 最後に来た順に並べる（先頭が一番長く来ていない IP）
        self._windows: OrderedDict[str, deque[float]] = OrderedDict()
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
            if self.per_minute > 0:
                window = self._track(ip, now)
                if len(window) >= self.per_minute:
                    return Decision(False, max(1, int(60 - (now - window[0])) + 1), "minute")
                window.append(now)
            if self.per_ip_daily > 0:
                # 上限が無効なら IP ごとの日次件数は使わないので、記録もしない（増え続けないように）
                self._ip_day[ip] = self._ip_day.get(ip, 0) + 1
            self._day_total += 1
            return Decision(True)

    def _track(self, ip: str, now: float) -> deque[float]:
        """Return ``ip``'s window (pruned to the last minute), keeping at most ``_MAX_TRACKED_IPS`` IPs."""
        # 取り出して末尾に入れ直す = 最後に来た IP にする（自分の記録が先頭で捨てられることはない）
        window = self._windows.pop(ip, None) or deque()
        # 先頭から、1分より古い記録しかない IP の追跡をやめる。1分以内に来た IP だけで上限に届くとき
        # （大量の IP からの一斉アクセス）も、一番長く来ていない IP から捨てて上限を守る。
        # どちらも先頭から取るだけなので、1回あたりの手間は平均して一定
        while self._windows:
            oldest = next(iter(self._windows.values()))
            if len(self._windows) < _MAX_TRACKED_IPS and oldest and now - oldest[-1] < 60:
                break
            self._windows.popitem(last=False)
        self._windows[ip] = window
        while window and now - window[0] >= 60:
            window.popleft()
        return window

    @property
    def used_today(self) -> int:
        return self._day_total
