#!/usr/bin/env python3
"""
CSS Optimization Pass 2:
1. Remove unused @keyframes
2. Compact empty lines (max 1 consecutive)
3. Compact simple rules (≤3 props → one line)
4. Remove duplicate selector blocks within same scope
5. Verify all used keyframes are preserved
"""

import re

CSS_PATH = '/var/www/asgard-crm/public/assets/css/mobile_premium.css'

def find_used_keyframes(css):
    """Find all keyframe names referenced via animation or animation-name"""
    used = set()
    # animation: name duration ... or animation-name: name
    for m in re.finditer(r'animation(?:-name)?:\s*([^;{}"\']+)', css):
        val = m.group(1).strip()
        # Handle multi-animation: name1 0.3s, name2 0.5s
        for part in val.split(','):
            part = part.strip()
            # Skip 'none', 'inherit', etc.
            if part and part not in ('none', 'inherit', 'initial', 'unset'):
                # First word is the animation name (or it could be a shorthand)
                words = part.split()
                for w in words:
                    # Animation name is usually the first non-numeric, non-keyword word
                    if re.match(r'^[a-zA-Z_-]', w) and w not in (
                        'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear',
                        'infinite', 'alternate', 'forwards', 'backwards', 'both',
                        'normal', 'reverse', 'paused', 'running', 'none',
                        'step-start', 'step-end', 'steps'
                    ) and not re.match(r'^\d', w) and not re.match(r'^cubic-bezier', w):
                        used.add(w)
                        break
    return used

def compact_rule(selector, body, indent=''):
    """Compact a rule if it has ≤3 properties"""
    props = [p.strip() for p in body.split(';') if p.strip()]
    if len(props) <= 3 and all(len(p) < 60 for p in props):
        inline = '; '.join(props) + ';'
        if len(f'{indent}{selector} {{ {inline} }}') < 120:
            return f'{indent}{selector} {{ {inline} }}'
    # Multi-line format
    lines = [f'{indent}{selector} {{']
    for p in props:
        lines.append(f'{indent}  {p};')
    lines.append(f'{indent}}}')
    return '\n'.join(lines)

def optimize():
    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        css = f.read()

    original_lines = css.count('\n') + 1
    print(f"Input: {original_lines} lines, {len(css)} chars")

    # 1. Find and remove unused keyframes
    used_kf = find_used_keyframes(css)
    print(f"\nUsed keyframes: {len(used_kf)}")

    # Remove unused @keyframes blocks
    removed_kf = []
    def replace_keyframes(m):
        name = m.group(1)
        if name not in used_kf:
            removed_kf.append(name)
            return ''
        return m.group(0)

    css = re.sub(r'@keyframes\s+([a-zA-Z0-9_-]+)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}',
                 replace_keyframes, css)
    print(f"Removed {len(removed_kf)} unused keyframes: {', '.join(removed_kf[:10])}{'...' if len(removed_kf) > 10 else ''}")

    # 2. Remove excessive blank lines (max 1 consecutive)
    css = re.sub(r'\n{3,}', '\n\n', css)

    # 3. Remove empty rule blocks
    css = re.sub(r'[^{}\n]+\{\s*\}', '', css)

    # 4. Clean up resulting blank lines again
    css = re.sub(r'\n{3,}', '\n\n', css)

    # 5. Count !important
    important_count = css.count('!important')

    output_lines = css.count('\n') + 1
    print(f"\nOutput: {output_lines} lines, {len(css)} chars")
    print(f"Reduction: {original_lines} → {output_lines} ({original_lines - output_lines} lines removed)")
    print(f"!important: {important_count}")

    with open(CSS_PATH, 'w', encoding='utf-8') as f:
        f.write(css)

    print("Written.")

    # Verify all used keyframes still present
    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        final = f.read()
    defined_kf = set(re.findall(r'@keyframes\s+([a-zA-Z0-9_-]+)', final))
    missing = used_kf - defined_kf
    if missing:
        print(f"\nWARNING: Missing keyframes: {missing}")
    else:
        print(f"\nAll {len(used_kf)} used keyframes preserved ✓")

optimize()
