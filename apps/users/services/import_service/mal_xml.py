"""MyAnimeList XML export import (``.xml`` or ``.xml.gz``).

The view parses the upload once (``parse_mal_xml``) and stores compact entries on the
job (``UserImportJob.payload``), so the file never travels through the broker and an
admin requeue of the job still has its data.
"""

from __future__ import annotations

import gzip
import io
import zlib
from typing import TYPE_CHECKING, Any

from defusedxml import DefusedXmlException, ElementTree

from .base import BaseImporter, ImportSourceError
from .entries import ImportedEntry, mal_xml_entry

if TYPE_CHECKING:
    from ...models import UserImportJob

# Upload limit (compressed or not) and the most a gzip may expand to.
MAX_XML_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_XML_DECOMPRESSED_BYTES = 20 * 1024 * 1024
GZIP_MAGIC = b"\x1f\x8b"
_READ_CHUNK = 64 * 1024


class XMLImportError(ValueError):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def read_upload(raw: bytes) -> bytes:
    """The XML bytes of an upload, gunzipped (bounded, streamed) when it is a gzip file."""
    if not raw.startswith(GZIP_MAGIC):
        return raw
    out = io.BytesIO()
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            while chunk := stream.read(_READ_CHUNK):
                out.write(chunk)
                if out.tell() > MAX_XML_DECOMPRESSED_BYTES:
                    raise XMLImportError(
                        "The file is too large once decompressed (20 MB at most).",
                        "xml_file_too_large",
                    )
    except (OSError, EOFError, zlib.error) as exc:
        raise XMLImportError("The file is not a valid gzip archive.", "invalid_xml_file") from exc
    return out.getvalue()


def parse_mal_xml(content: bytes | str) -> list[ImportedEntry]:
    try:
        root = ElementTree.fromstring(content)
    except (ElementTree.ParseError, DefusedXmlException) as exc:
        raise XMLImportError("Invalid XML file format", "invalid_xml_file") from exc
    return [mal_xml_entry(element) for element in root.findall("anime")]


class MyAnimeListXMLImporter(BaseImporter):
    source_name = "mal_xml"

    def __init__(self, job: UserImportJob, xml_content: str | None = None, **kwargs: Any):
        super().__init__(job, **kwargs)
        # ``xml_content`` only for jobs queued before the payload field existed.
        self.xml_content = xml_content

    def load_entries(self) -> list[ImportedEntry]:
        payload = self.job.payload or {}
        if isinstance(payload, dict) and isinstance(payload.get("entries"), list):
            return [ImportedEntry.from_payload(item) for item in payload["entries"]]
        if self.xml_content:
            try:
                return parse_mal_xml(self.xml_content)
            except XMLImportError as exc:
                raise ImportSourceError(str(exc)) from exc
        raise ImportSourceError("The uploaded file is no longer available. Upload it again.")
