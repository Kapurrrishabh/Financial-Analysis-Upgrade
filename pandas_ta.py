"""Compatibility shim for pandas_ta.

This project depends on the pandas_ta import name, but the environment here
provides the maintained pandas-ta-classic fork. Re-export its public API so
existing imports keep working without changing the feature-engineering code.
"""

from pandas_ta_classic import *  # type: ignore

try:
    from pandas_ta_classic import __all__ as _classic_all

    __all__ = list(_classic_all)
except Exception:
    __all__ = [name for name in globals() if not name.startswith("_")]