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
    assert not rl._windows  # 1分あたりの上限が無効なら、IP ごとの記録も持たない


def test_tracking_cap_evicts_ips_whose_requests_have_expired(monkeypatch):
    from knowledge_ai.api import ratelimit

    monkeypatch.setattr(ratelimit, "_MAX_TRACKED_IPS", 3)
    clock = Clock(at(2026, 10, 6, 12))
    rl = RateLimiter(per_minute=5, per_ip_daily=100, daily_cap=1000, clock=clock)
    for ip in ("a", "b", "c"):
        assert rl.check(ip).allowed
    clock.t += 61  # a, b, c are now older than the one-minute window
    assert rl.check("d").allowed  # 4 tracked > cap of 3: stale ones must be dropped
    assert set(rl._windows) == {"d"}


def test_per_ip_daily_counts_are_not_kept_when_that_cap_is_disabled():
    clock = Clock(at(2026, 10, 6, 12))
    rl = RateLimiter(per_minute=5, per_ip_daily=0, daily_cap=1000, clock=clock)
    for i in range(50):
        assert rl.check(f"10.0.0.{i}").allowed
    assert rl._ip_day == {}
    assert rl.used_today == 50


def test_tracking_cap_holds_even_when_every_ip_is_active(monkeypatch):
    from knowledge_ai.api import ratelimit

    monkeypatch.setattr(ratelimit, "_MAX_TRACKED_IPS", 3)
    clock = Clock(at(2026, 10, 6, 12))
    rl = RateLimiter(per_minute=5, per_ip_daily=100, daily_cap=1000, clock=clock)
    # 1分以内に上限を超える数の IP が来ても、追跡するのは最後に来た3つまで
    for ip in "abcdefgh":
        clock.t += 1
        assert rl.check(ip).allowed
        assert len(rl._windows) <= 3
    assert list(rl._windows) == ["f", "g", "h"]
    # 来るたびに「最後に来た IP」になるので、次に捨てられるのは一番長く来ていない g
    assert rl.check("f").allowed
    assert rl.check("x").allowed
    assert list(rl._windows) == ["h", "f", "x"]


def test_a_client_is_never_evicted_by_its_own_request(monkeypatch):
    from knowledge_ai.api import ratelimit

    monkeypatch.setattr(ratelimit, "_MAX_TRACKED_IPS", 2)
    clock = Clock(at(2026, 10, 6, 12))
    rl = RateLimiter(per_minute=2, per_ip_daily=100, daily_cap=1000, clock=clock)
    assert rl.check("a").allowed
    assert rl.check("b").allowed
    # a は一番長く来ていないが、a 自身のリクエストで a の記録が消えて制限が外れることはない
    assert rl.check("a").allowed
    assert rl.check("a").reason == "minute"


def test_per_ip_daily_cap_requires_a_global_cap():
    import pytest

    # 全体の上限がないと、IP ごとの日次件数の記録が0時まで増え続けるので、設定の時点で止める
    with pytest.raises(ValueError, match="KAI_DAILY_CAP"):
        RateLimiter(per_minute=5, per_ip_daily=100, daily_cap=0)
    RateLimiter(per_minute=5, per_ip_daily=0, daily_cap=0)  # no per-IP daily records at all: fine
    rl = RateLimiter(per_minute=0, per_ip_daily=2, daily_cap=3, clock=Clock(at(2026, 10, 6, 12)))
    for i in range(10):
        rl.check(f"10.0.0.{i}")
    assert len(rl._ip_day) <= 3  # bounded by the global cap
