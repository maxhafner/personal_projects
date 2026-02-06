#!/usr/bin/env python3
"""Serve the Great Lakes Ice Watch static site plus NOAA proxy endpoints."""

from __future__ import annotations

import argparse
import json
import os
import ssl
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

NOAA_BASE_ENDPOINT = (
    "https://apps.glerl.noaa.gov/erddap/tabledap/"
    "glerlIce.json?time,Superior,Michigan,Huron,Erie,Ontario,GL_Total"
)

NOAA_LATEST_ENDPOINTS = [
    NOAA_BASE_ENDPOINT + "&orderByMax(%22time%22)",
    NOAA_BASE_ENDPOINT,
]


def _is_certificate_error(exc: Exception) -> bool:
    reason = getattr(exc, "reason", None)

    if isinstance(exc, (ssl.SSLError, ssl.SSLCertVerificationError)):
        return True
    if isinstance(reason, (ssl.SSLError, ssl.SSLCertVerificationError)):
        return True
    if "CERTIFICATE_VERIFY_FAILED" in str(exc):
        return True

    return False


def _fetch_url(endpoint: str) -> bytes:
    request = Request(endpoint, headers={"User-Agent": "GreatLakesIceWatch/1.0"})
    strict_context = ssl.create_default_context()

    try:
        with urlopen(request, timeout=14, context=strict_context) as response:
            payload = response.read()
            status = getattr(response, "status", 200)
    except (ssl.SSLError, ssl.SSLCertVerificationError, URLError) as exc:
        if not _is_certificate_error(exc):
            raise

        # Fallback for local Python installs missing CA certificates.
        insecure_context = ssl._create_unverified_context()
        with urlopen(request, timeout=14, context=insecure_context) as response:
            payload = response.read()
            status = getattr(response, "status", 200)

    if not (200 <= status < 300):
        raise RuntimeError(f"HTTP {status}")
    if not payload:
        raise RuntimeError("Empty response body")

    return payload


def _fetch_json(endpoint: str) -> dict[str, Any]:
    payload = _fetch_url(endpoint)
    decoded = payload.decode("utf-8")
    return json.loads(decoded)


def _parse_time(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)

    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _extract_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    table = payload.get("table")
    if not isinstance(table, dict):
        return []

    column_names = table.get("columnNames")
    rows = table.get("rows")
    if not isinstance(column_names, list) or not isinstance(rows, list):
        return []

    parsed_rows: list[dict[str, Any]] = []
    for raw_row in rows:
        if not isinstance(raw_row, list):
            continue
        row = {name: raw_row[index] for index, name in enumerate(column_names) if index < len(raw_row)}
        parsed_rows.append(row)

    return parsed_rows


def _history_endpoint(days: int) -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days + 7)
    cutoff_text = cutoff.strftime("%Y-%m-%dT00:00:00Z")
    return NOAA_BASE_ENDPOINT + f"&time%3E={cutoff_text}"


def _trim_history_rows(rows: list[dict[str, Any]], days: int) -> list[dict[str, Any]]:
    if not rows:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    trimmed = []

    for row in rows:
        time_text = str(row.get("time", ""))
        try:
            stamp = _parse_time(time_text)
        except ValueError:
            continue

        if stamp >= cutoff:
            trimmed.append(
                {
                    "time": time_text,
                    "Superior": _to_float(row.get("Superior")),
                    "Michigan": _to_float(row.get("Michigan")),
                    "Huron": _to_float(row.get("Huron")),
                    "Erie": _to_float(row.get("Erie")),
                    "Ontario": _to_float(row.get("Ontario")),
                    "GL_Total": _to_float(row.get("GL_Total")),
                }
            )

    return trimmed


class IceWatchHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]

        if path == "/api/ice-latest":
            self._handle_ice_latest()
            return

        if path == "/api/ice-history":
            self._handle_ice_history()
            return

        super().do_GET()

    def _history_days_from_query(self) -> int:
        query = ""
        if "?" in self.path:
            query = self.path.split("?", 1)[1]

        days = 90
        for pair in query.split("&"):
            if not pair.startswith("days="):
                continue
            try:
                days = int(pair.split("=", 1)[1])
            except ValueError:
                days = 90
            break

        return max(14, min(365, days))

    def _handle_ice_latest(self) -> None:
        errors: list[str] = []

        for endpoint in NOAA_LATEST_ENDPOINTS:
            try:
                payload = _fetch_url(endpoint)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)
                return
            except (HTTPError, URLError, TimeoutError, RuntimeError, ssl.SSLError, json.JSONDecodeError) as exc:
                errors.append(f"{endpoint}: {exc}")

        self._send_error_json(errors)

    def _handle_ice_history(self) -> None:
        days = self._history_days_from_query()
        errors: list[str] = []

        endpoints = [_history_endpoint(days), NOAA_BASE_ENDPOINT]

        for endpoint in endpoints:
            try:
                payload = _fetch_json(endpoint)
                rows = _extract_rows(payload)
                if not rows:
                    raise RuntimeError("No rows returned")

                trimmed = _trim_history_rows(rows, days)
                if not trimmed:
                    raise RuntimeError("No rows in requested date range")

                response_payload = {
                    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "days": days,
                    "rows": trimmed,
                }

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(json.dumps(response_payload).encode("utf-8"))
                return
            except (HTTPError, URLError, TimeoutError, RuntimeError, ssl.SSLError, json.JSONDecodeError) as exc:
                errors.append(f"{endpoint}: {exc}")

        self._send_error_json(errors)

    def _send_error_json(self, errors: list[str]) -> None:
        self.send_response(502)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {
                    "error": "Unable to fetch NOAA data.",
                    "details": errors,
                }
            ).encode("utf-8")
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Great Lakes Ice Watch local server.")
    parser.add_argument(
        "--host",
        default=os.getenv("HOST", "0.0.0.0"),
        help="Host to listen on (default: HOST env var or 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("PORT", "8080")),
        help="Port to listen on (default: PORT env var or 8080)",
    )
    args = parser.parse_args()

    site_root = Path(__file__).resolve().parent
    os.chdir(site_root)

    server = ThreadingHTTPServer((args.host, args.port), IceWatchHandler)
    print(f"Serving Great Lakes Ice Watch at http://{args.host}:{args.port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
