#!/usr/bin/env python3
"""Emit KT usage data in a shape the wrapped Bun app can consume."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone, tzinfo
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]


def _bootstrap_kohakuterrarium() -> None:
    here = Path(__file__).resolve()
    candidates = []

    env_path = os.environ.get("KT_WRAPPED_KT_SRC")
    if env_path:
        candidates.append(Path(env_path).expanduser())

    candidates.extend(
        [
            here.parents[2] / "KohakuTerrarium" / "src",
            Path.home() / "Downloads" / "KohakuTerrarium" / "src",
        ]
    )

    for candidate in candidates:
        if candidate.exists():
            sys.path.insert(0, str(candidate))


_bootstrap_kohakuterrarium()

from kohakuterrarium.llm.profiles import get_profile  # type: ignore  # noqa: E402
from kohakuterrarium.session.store import SessionStore  # type: ignore  # noqa: E402


DEFAULT_SESSION_DIR = Path.home() / ".kohakuterrarium" / "sessions"
UNKNOWN_MODEL = "unknown"
UTC = timezone.utc


@dataclass
class ModelContext:
    model: str = UNKNOWN_MODEL
    llm_name: str = ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect KT wrapped usage data")
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--session-dir", default=str(DEFAULT_SESSION_DIR))
    parser.add_argument("--timezone", default=None)
    parser.add_argument(
        "--dashboard",
        action="store_true",
        help="Emit per-session data for every year (for kt-wrapped --web)",
    )
    args = parser.parse_args()
    if args.year is None and not args.dashboard:
        parser.error("--year is required unless --dashboard is given")

    timezone_info = _resolve_timezone(args.timezone)
    session_dir = Path(args.session_dir).expanduser()
    if args.dashboard:
        payload = collect_dashboard(session_dir=session_dir, timezone_info=timezone_info)
    else:
        payload = collect_usage(
            args.year,
            session_dir=session_dir,
            timezone_info=timezone_info,
        )
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    return 0


def collect_usage(
    year: int,
    *,
    session_dir: Path,
    timezone_info: tzinfo,
) -> dict[str, Any]:
    files = sorted([*session_dir.glob("*.kohakutr"), *session_dir.glob("*.kt")])

    events: list[dict[str, Any]] = []
    daily_activity: dict[str, int] = defaultdict(int)
    projects: set[str] = set()

    total_messages = 0
    total_sessions = 0
    earliest_session_date: str | None = None

    for path in files:
        store = SessionStore(path)
        try:
            meta = store.load_meta()
            session_id = str(meta.get("session_id") or path.stem)
            project = str(meta.get("pwd") or "")
            session_created = _meta_iso_date(meta.get("created_at"))
            if session_created and (
                earliest_session_date is None or session_created < earliest_session_date
            ):
                earliest_session_date = session_created

            agents = [str(agent) for agent in meta.get("agents", []) if agent]
            session_active = False

            for agent in agents:
                context = _initial_model_context(store, agent)
                for event in store.get_events(agent):
                    event_type = str(event.get("type") or "")
                    if event_type == "activity:session_info":
                        context = _merge_model_context(context, event)
                        continue

                    event_dt = _coerce_datetime(event.get("ts"), timezone_info)
                    if event_dt is None or event_dt.year != year:
                        continue

                    day_key = event_dt.date().isoformat()
                    if event_type in {"user_input", "trigger_fired"}:
                        total_messages += 1
                        daily_activity[day_key] += 1
                        session_active = True
                        continue

                    if event_type != "token_usage":
                        continue

                    events.append(_usage_event(session_id, event_dt, context, event))
                    session_active = True

            if session_active:
                total_sessions += 1
                if project:
                    projects.add(project)
        finally:
            store.close(update_status=False)

    events.sort(key=lambda item: item["timestamp"])

    return {
        "events": events,
        "dailyActivity": dict(sorted(daily_activity.items())),
        "totalMessages": total_messages,
        "totalSessions": total_sessions,
        "projects": sorted(projects),
        "earliestSessionDate": earliest_session_date,
    }


def collect_dashboard(*, session_dir: Path, timezone_info: tzinfo) -> dict[str, Any]:
    """Every year's usage, prompts and tool calls, keyed by session."""
    files = sorted([*session_dir.glob("*.kohakutr"), *session_dir.glob("*.kt")])

    sessions: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    prompts: list[dict[str, Any]] = []
    tool_calls: list[dict[str, Any]] = []
    seen_calls: set[str] = set()
    # Copied or forked session files repeat events with the same timestamp and id.
    seen_events: set[tuple[str, str, Any]] = set()

    for path in files:
        store = SessionStore(path)
        try:
            meta = store.load_meta()
            session_id = str(meta.get("session_id") or path.stem)
            start: datetime | None = None
            end: datetime | None = None

            for agent in [str(agent) for agent in meta.get("agents", []) if agent]:
                context = _initial_model_context(store, agent)
                for event in store.get_events(agent):
                    event_type = str(event.get("type") or "")
                    if event_type == "activity:session_info":
                        context = _merge_model_context(context, event)
                        continue

                    event_dt = _coerce_datetime(event.get("ts"), timezone_info)
                    if event_dt is None:
                        continue
                    start = event_dt if start is None or event_dt < start else start
                    end = event_dt if end is None or event_dt > end else end

                    if event_type in {"user_input", "token_usage"}:
                        event_key = (event_type, repr(event.get("ts")), event.get("event_id"))
                        if event_key in seen_events:
                            continue
                        seen_events.add(event_key)

                    if event_type == "user_input":
                        prompts.append(
                            {
                                "sessionKey": session_id,
                                "timestamp": event_dt.isoformat(),
                                "text": _prompt_text(event.get("content"))[:300],
                            }
                        )
                    elif event_type == "token_usage":
                        events.append(_usage_event(session_id, event_dt, context, event))
                    elif event_type == "tool_call" and event.get("name"):
                        call_id = str(
                            event.get("call_id")
                            or f"{session_id}:{agent}:{event.get('event_id') or event.get('ts')}"
                        )
                        if call_id in seen_calls:
                            continue
                        seen_calls.add(call_id)
                        tool_calls.append(
                            {
                                "sessionKey": session_id,
                                "timestamp": event_dt.isoformat(),
                                # Older logs name calls like "read[2a1220]"; the suffix is a job id.
                                "name": re.sub(r"\[[0-9a-f]{4,}\]$", "", str(event.get("name"))),
                            }
                        )

            if start is not None and end is not None:
                sessions.append(
                    {
                        "key": session_id,
                        "project": str(meta.get("pwd") or ""),
                        "start": start.isoformat(),
                        "end": end.isoformat(),
                        "title": meta.get("title") or meta.get("name") or None,
                    }
                )
        finally:
            store.close(update_status=False)

    events.sort(key=lambda item: item["timestamp"])
    return {
        "sessions": sessions,
        "events": events,
        "prompts": prompts,
        "toolCalls": tool_calls,
    }


def _usage_event(
    session_id: str, event_dt: datetime, context: ModelContext, event: dict[str, Any]
) -> dict[str, Any]:
    prompt_tokens = _as_int(event.get("prompt_tokens"))
    # Anthropic backends report cache reads/writes under their native names.
    cached_tokens = _as_int(
        event.get("cached_tokens") or event.get("cache_read_input_tokens")
    )
    cache_write_tokens = _as_int(
        event.get("cache_write_tokens") or event.get("cache_creation_input_tokens")
    )
    completion_tokens = _as_int(event.get("completion_tokens"))
    reasoning_tokens = _as_int(
        event.get("reasoning_tokens") or event.get("reasoning_output_tokens")
    )
    total_tokens = _as_int(event.get("total_tokens"))
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens

    return {
        "sessionKey": session_id,
        "timestamp": event_dt.isoformat(),
        "model": context.model or UNKNOWN_MODEL,
        "inputTokens": prompt_tokens,
        "cachedInputTokens": cached_tokens,
        "cacheWriteTokens": cache_write_tokens,
        "outputTokens": completion_tokens,
        "reasoningOutputTokens": reasoning_tokens,
        "totalTokens": total_tokens,
    }


def _prompt_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        texts = [
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        text = " ".join(t for t in texts if t).strip()
        if text:
            return text
        if any(isinstance(part, dict) and part.get("type") != "text" for part in content):
            return "[image]"
    return ""


def _initial_model_context(store: SessionStore, agent: str) -> ModelContext:
    try:
        llm_name = store.state[f"{agent}:llm_profile"]
    except KeyError:
        llm_name = ""
    return _resolve_model_context(llm_name=llm_name)


def _merge_model_context(current: ModelContext, event: dict[str, Any]) -> ModelContext:
    llm_name = str(event.get("llm_name") or current.llm_name or "")
    model_name = str(event.get("model") or "")
    resolved = _resolve_model_context(model=model_name, llm_name=llm_name)
    if resolved.model != UNKNOWN_MODEL:
        return resolved
    return current


def _resolve_model_context(*, model: str = "", llm_name: str = "") -> ModelContext:
    try:
        profile = get_profile(llm_name) if llm_name else None
    except Exception:
        # e.g. a bare preset name shared by several providers raises ValueError.
        profile = None
    resolved_model = model or (profile.model if profile else "") or UNKNOWN_MODEL
    return ModelContext(model=resolved_model, llm_name=llm_name)


def _resolve_timezone(name: str | None) -> tzinfo:
    if name and ZoneInfo is not None:
        return ZoneInfo(name)
    return datetime.now().astimezone().tzinfo or UTC


def _coerce_datetime(value: Any, timezone_info: tzinfo) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value, tz=UTC)
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    else:
        return None
    return dt.astimezone(timezone_info)


def _meta_iso_date(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        return None


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
