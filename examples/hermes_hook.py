from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


GUARD = Path(__file__).resolve().parents[1] / "guard.mjs"


def on_user_message(message: str, session_id: str = "hermes-default") -> str:
    """Hermes hook example.

    Put this call before sending the user's message to the model. The returned
    string is the guarded prompt payload.
    """
    proc = subprocess.run(
        [
            "node",
            str(GUARD),
            "wrap",
            "--agent",
            "hermes",
            "--session-id",
            session_id,
            "--format",
            "json",
            "--stdin",
        ],
        input=message,
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    return payload["guarded_message"]


if __name__ == "__main__":
    print(on_user_message("请核对这篇论文是不是真的：Mind the Gap EACL 2026"))
