"""
Splits large file content into overlapping chunks so a pillar scan gets
full coverage instead of being silently truncated at a flat character
cutoff. Each chunk carries its starting line number so findings reported
within a chunk can be translated back to real line numbers in the file.
"""

CHUNK_SIZE = 3000       # matches the previous flat truncation size
CHUNK_OVERLAP = 300     # shared context between adjacent chunks, so an
                        # issue near a boundary isn't split and missed


def chunk_file_content(content: str) -> list:
    """
    Returns a list of {"text": str, "start_line": int} dicts. If the
    content fits in one chunk, returns a single-item list (no behavior
    change from before for small files).
    """
    if len(content) <= CHUNK_SIZE:
        return [{"text": content, "start_line": 1}]

    lines = content.splitlines(keepends=True)
    chunks = []
    current_chunk_lines = []
    current_chunk_chars = 0
    current_start_line = 1
    line_number = 1

    i = 0
    while i < len(lines):
        line = lines[i]
        current_chunk_lines.append(line)
        current_chunk_chars += len(line)
        line_number += 1

        if current_chunk_chars >= CHUNK_SIZE or i == len(lines) - 1:
            chunks.append({
                "text": "".join(current_chunk_lines),
                "start_line": current_start_line,
            })

            if i == len(lines) - 1:
                break

            # Step back by roughly CHUNK_OVERLAP characters worth of lines
            # so the next chunk shares some context with this one.
            overlap_chars = 0
            overlap_lines = 0
            for back_line in reversed(current_chunk_lines):
                overlap_chars += len(back_line)
                overlap_lines += 1
                if overlap_chars >= CHUNK_OVERLAP:
                    break

            current_start_line = line_number - overlap_lines
            current_chunk_lines = current_chunk_lines[-overlap_lines:]
            current_chunk_chars = sum(len(l) for l in current_chunk_lines)

        i += 1

    return chunks


def adjust_finding_line(reported_line, chunk_start_line: int):
    """
    A finding's line number, as reported by the AI, is relative to the
    chunk it saw (starting at 1). Translate it to the real file's line
    number by adding the chunk's offset.
    """
    if reported_line is None:
        return None
    try:
        return int(reported_line) + chunk_start_line - 1
    except (TypeError, ValueError):
        return reported_line