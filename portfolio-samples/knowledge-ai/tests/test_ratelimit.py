from datetime import datetime
from zoneinfo import ZoneInfo

from knowledge_ai.api.ratelimit import RateLimiter

JST = ZoneInfo("Asia/Tokyo")


class Clock:
    def __init__(self, t: float) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def at(y, mo, d, h, mi=0, s=0) -> float:
    return datetime(y, mo, d, h, mi, s, tzinfo=JST).timestamp()


def test_sliding_minute_window_per_ip():
    clock = Clock(at(2026, 10, 6, 12))
    rl = RateLimiter(per_minute=2, per_ip_daily=100, daily_cap=100, clock=clock)
    assert rl.check("a").allowed and rl.check("a").allowed
    d = rl.check("a")
    assert not d.allowed and d.reason == "minute" and 1 <= d.retry_after <= 61
    assert rl.check("b").allowed  # other clients are unaffected
    clock.t += 61
    assert rl.check("a").allowed


def test_per_ip_and_global_daily_caps_reset_at_local_midnight():
    clock = Clock(at(2026, 10, 6, 23, 59, 0))
    rl = RateLimiter(per_minute=100, per_ip_daily=2, daily_cap=3, clock=clock)
    assert rl.check("a").allowed and rl.check("a").allowed
    d = rl.check("a")
    assert not d.allowed and d.reason == "ip_daily" and d.retry_after <= 60
    assert rl.check("b").allowed
    d = rl.check("c")
    assert not d.allowed and d.reason == "daily"
    clock.t = at(2026, 10, 7, 0, 0, 1)  # new day in Asia/Tokyo
    assert rl.check("a").allowed
    assert rl.used_today == 1


def test_zero_disables_a_limit():
    rl = RateLimiter(per_minute=0, per_ip_daily=0, daily_cap=0, clock=Clock(0.0))
    assert all(rl.check("a").allowed for _ in range(50))
