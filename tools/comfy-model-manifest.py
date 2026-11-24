#!/usr/bin/env python3
"""Hash model files requested by a ComfyUI API workflow on the host that stores them.

This verifies an unambiguous workflow-filename-to-disk-file mapping. An optional
provider fingerprint binds the manifest to an ARC ComfyUI endpoint. It does not
prove ComfyUI loaded those bytes at runtime. Output intentionally omits paths.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


MODEL_SUFFIXES = {".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".bin"}
NODE_ID = re.compile(r"^\d+(?::\d+)*$")
MAX_WORKFLOW_BYTES = 8 * 1024 * 1024
MAX_NODES = 10_000
CHUNK_SIZE = 4 * 1024 * 1024


def load_prompt(path: Path) -> tuple[dict[str, Any], str]:
    size = path.stat().st_size
    if size < 1 or size > MAX_WORKFLOW_BYTES:
        raise ValueError("Workflow JSON size is outside the 1 byte to 8 MiB limit.")
    content = path.read_bytes()
    data = json.loads(content)
    if isinstance(data, dict) and isinstance(data.get("nodes"), list):
        raise ValueError("Workflow must be exported as ComfyUI API JSON, not editor JSON.")
    prompt = data.get("prompt") if isinstance(data, dict) and isinstance(data.get("prompt"), dict) else data
    if not isinstance(prompt, dict) or not prompt or len(prompt) > MAX_NODES:
        raise ValueError("Expected a ComfyUI API workflow object with 1 to 10,000 nodes.")
    for node_id, node in prompt.items():
        if not isinstance(node_id, str) or not NODE_ID.fullmatch(node_id):
            raise ValueError("Workflow contains an invalid node ID.")
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str) or not isinstance(node.get("inputs"), dict):
            raise ValueError("Workflow must be exported as ComfyUI API JSON.")
    return prompt, hashlib.sha256(content).hexdigest()


def requested_models(prompt: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for node_id, node in prompt.items():
        for field, value in node["inputs"].items():
            if not isinstance(value, str) or Path(value).suffix.lower() not in MODEL_SUFFIXES:
                continue
            name = Path(value.replace("\\", "/")).name
            if not name or name in {".", ".."} or "\x00" in name:
                continue
            rows.append({"node": node_id, "classType": node["class_type"], "field": str(field), "file": name})
    # A filename requested in multiple nodes is listed once per node: each node
    # remains auditable while repeated references share the same disk hash.
    return rows


def model_set_sha256(requests: list[dict[str, str]]) -> str:
    rows = sorted([[item["node"], item["classType"], item["field"], item["file"]] for item in requests])
    canonical = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def index_model_files(root: Path) -> dict[str, list[Path]]:
    if not root.is_dir():
        raise ValueError("A model root is not an accessible directory.")
    base = root.resolve(strict=True)
    matches: dict[str, list[Path]] = {}
    for current, dirs, files in os.walk(base, followlinks=False):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if not (current_path / name).is_symlink()]
        for filename in files:
            candidate = current_path / filename
            if candidate.suffix.lower() not in MODEL_SUFFIXES or candidate.is_symlink():
                continue
            matches.setdefault(filename, []).append(candidate)
    return matches


def hash_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK_SIZE):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def manifest(prompt: dict[str, Any], workflow_sha256: str, roots: list[Path],
             provider_fingerprint: str | None = None) -> dict[str, Any]:
    requests = requested_models(prompt)
    if not requests:
        raise ValueError("No model weight filenames were found in the API workflow inputs.")
    indexes = [index_model_files(root) for root in roots]
    entries: list[dict[str, Any]] = []
    errors: list[str] = []
    cache: dict[Path, tuple[int, str]] = {}
    for request in requests:
        candidates = [path for index in indexes for path in index.get(request["file"], [])]
        # Distinct search roots may alias the same file. Resolve and deduplicate
        # before requiring a unique filename match.
        candidates = sorted(set(candidates), key=lambda item: str(item).casefold())
        unique: dict[str, Path] = {}
        for candidate in candidates:
            try:
                resolved = candidate.resolve(strict=True)
                if any(resolved.is_relative_to(root.resolve(strict=True)) for root in roots):
                    unique[str(resolved).casefold()] = resolved
            except (OSError, RuntimeError):
                continue
        candidates = list(unique.values())
        if len(candidates) != 1:
            errors.append(f"{request['node']} {request['classType']} {request['field']} {request['file']}: " +
                          ("missing" if not candidates else "ambiguous filename"))
            continue
        path = candidates[0]
        if path not in cache:
            cache[path] = hash_file(path)
        size, digest = cache[path]
        entries.append({**request, "sizeBytes": size, "sha256": digest})
    if errors:
        raise ValueError("Model file verification failed:\n" + "\n".join(errors))
    if provider_fingerprint is not None and not re.fullmatch(r"[a-f0-9]{64}", provider_fingerprint):
        raise ValueError("Provider fingerprint must be a 64-character lowercase SHA-256 value.")
    report = {"schema": "arc-comfy-model-files-v3" if provider_fingerprint else "arc-comfy-model-files-v2",
              "evidence": "workflow-requested-files-present-and-hashed", "runtimeLoadedVerified": False,
              "workflowSha256": workflow_sha256, "modelSetSha256": model_set_sha256(entries), "models": entries}
    if provider_fingerprint:
        report["providerFingerprint"] = provider_fingerprint
        report["providerBinding"] = "operator-supplied-endpoint-fingerprint"
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow", required=True, type=Path, help="ComfyUI API workflow JSON used for the task")
    parser.add_argument("--models-root", required=True, action="append", type=Path,
                        help="ComfyUI models directory; repeat for separately mounted model roots")
    parser.add_argument("--provider-fingerprint",
                        help="SHA-256 provider fingerprint copied from the matching ARC ComfyUI endpoint profile; binds file evidence to that endpoint")
    parser.add_argument("--output", type=Path, help="Write manifest JSON here; defaults to stdout")
    args = parser.parse_args()
    try:
        prompt, workflow_sha256 = load_prompt(args.workflow)
        result = manifest(prompt, workflow_sha256, args.models_root, args.provider_fingerprint)
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            if args.output.resolve(strict=False) == args.workflow.resolve(strict=True):
                raise ValueError("Manifest output must not overwrite the workflow JSON.")
            with args.output.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded)
        else:
            sys.stdout.write(encoded)
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
