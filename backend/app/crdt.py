"""Yjs/Yrs documents (pycrdt). Shared files are CRDTs; humans and agents edit with a named origin."""

from __future__ import annotations

from pycrdt import Doc, Text

CONTENT = "content"


def origin_bytes(actor: str) -> bytes:
    return (actor or "system").encode("utf-8")[:200]


def load_doc(state: bytes | None, fallback: str = "") -> Doc:
    doc = Doc()
    text = doc.get(CONTENT, type=Text)
    if state:
        doc.apply_update(state)
        return doc
    if fallback:
        with doc.transaction(origin=b"migrate"):
            text += fallback
    return doc


def encode_state(doc: Doc) -> bytes:
    return doc.get_update()


def read_text(doc: Doc) -> str:
    return str(doc.get(CONTENT, type=Text))


def replace_text(doc: Doc, text: str, actor: str) -> None:
    ytext = doc.get(CONTENT, type=Text)
    with doc.transaction(origin=origin_bytes(actor)):
        ytext.clear()
        if text:
            ytext += text


def apply_update(doc: Doc, update: bytes) -> None:
    doc.apply_update(update)


def merge_concurrent_appends(base: str, left: str, right: str, left_actor: str, right_actor: str) -> tuple[str, str]:
    """Two clients fork the same state, append, then exchange updates. Both must converge."""
    seed_doc = load_doc(None, base)
    seed = encode_state(seed_doc)
    vector = seed_doc.get_state()
    doc_a = load_doc(seed)
    doc_b = load_doc(seed)
    text_a = doc_a.get(CONTENT, type=Text)
    text_b = doc_b.get(CONTENT, type=Text)
    with doc_a.transaction(origin=origin_bytes(left_actor)):
        text_a += left
    with doc_b.transaction(origin=origin_bytes(right_actor)):
        text_b += right
    update_a = doc_a.get_update(vector)
    update_b = doc_b.get_update(vector)
    doc_a.apply_update(update_b)
    doc_b.apply_update(update_a)
    return read_text(doc_a), read_text(doc_b)


def replay_state(state: bytes) -> str:
    return read_text(load_doc(state))
