"""Literal port of Replace-Once/Replace-Count calls in the pinned upstream PS1.

This is a narrow data reader, not a PowerShell evaluator. Unsupported syntax fails.
"""
import re


def decode_double(text):
    if re.search(r"\$(?:[A-Za-z_{])", text):
        raise ValueError("PowerShell interpolation is not supported")
    return re.sub(r"`(.)", lambda match: {"n": "\n", "r": "\r", "t": "\t",
                                             "`": "`", '"': '"'}.get(match[1], match[1]), text)


def read_literal(source, position):
    while position < len(source) and source[position].isspace():
        position += 1
    if source[position:position + 2] in ('@"', "@'"):
        quote = source[position + 1]
        if source[position + 2] != "\n":
            raise ValueError("Expected newline after here-string opener")
        end = source.index("\n" + quote + "@", position + 3)
        value = source[position + 3:end]
        return (decode_double(value) if quote == '"' else value), end + 3
    quote = source[position]
    if quote not in ('"', "'"):
        raise ValueError("Expected literal PowerShell string")
    position += 1
    chars = []
    while position < len(source):
        char = source[position]
        if char == "`" and quote == '"':
            chars.append(source[position:position + 2])
            position += 2
            continue
        if char == quote:
            value = "".join(chars)
            return (decode_double(value) if quote == '"' else value), position + 1
        chars.append(char)
        position += 1
    raise ValueError("Unterminated literal")


def rules_from_source(source):
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    rules = []
    for match in re.finditer(r"(?m)^Replace-(Once|Count) \$js\s+", source):
        old, end = read_literal(source, match.end())
        new, end = read_literal(source, end)
        tail = source[end:source.find("\n", end) if "\n" in source[end:] else len(source)].strip()
        if match[1] == "Count":
            if not tail.isdigit():
                raise ValueError("Expected integer replacement count")
            count = int(tail)
        else:
            if tail:
                raise ValueError("Unexpected replacement arguments")
            count = 1
        if not old or count < 1:
            raise ValueError("Empty pattern or invalid count")
        rules.append((old, new, count))
    if not rules:
        raise ValueError("No upstream rendering rules found")
    return rules


def apply_rules(text, rules):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    for index, (old, new, expected) in enumerate(rules, 1):
        actual = text.count(old)
        if actual != expected:
            raise ValueError(f"Renderer rule {index}: expected {expected} matches, found {actual}; no output published")
        text = text.replace(old, new)
    return re.sub(r"(?m)^\s*//\s*(?:end\s+)?include:\s*(?:[A-Za-z]:[\\/]|/).*\n?", "", text)
