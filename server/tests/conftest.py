"""
Make the `plumb` package importable regardless of where pytest is invoked from,
so `pytest server/tests` works from the repository root as well as from
`server/`.
"""

import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))
