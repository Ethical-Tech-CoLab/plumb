"""Plumb backend package."""

from .config import settings

__all__ = ["settings"]
__version__ = settings.version
