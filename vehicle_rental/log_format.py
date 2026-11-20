"""One JSON object per log line, so container logs can be shipped and queried as-is."""
import json
import logging
import re
from datetime import datetime, timezone

STANDARD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}
PAIR = re.compile(r"(\w+)=(\S+)")


class JsonFormatter(logging.Formatter):
    def format(self, record):
        message = record.getMessage()
        entry = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }
        # Messages written as "event key=value ..." also become fields.
        event, _, rest = message.partition(" ")
        pairs = dict(PAIR.findall(rest))
        if pairs and event.isidentifier():
            entry["event"] = event
            entry.update({key: value for key, value in pairs.items() if key not in entry})
        entry.update({key: value for key, value in vars(record).items()
                      if key not in STANDARD and not key.startswith("_") and key not in entry})
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)
