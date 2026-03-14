#!/usr/bin/env python3
"""
CSS Refactoring Script for mobile_premium.css
Consolidates 7000 lines of accumulated patches into a clean ~2500 line file.

Strategy:
1. Parse CSS into blocks (rules, @keyframes, @media, @supports)
2. For duplicate selectors: merge properties (later wins)
3. Remove dead classes not used in JS
4. Remove duplicate @keyframes (keep last)
5. Output clean, organized file grouped by component
"""

import re, os, sys, shutil
from collections import OrderedDict
from datetime import datetime

ROOT = '/var/www/asgard-crm'
CSS_PATH = f'{ROOT}/public/assets/css/mobile_premium.css'
JS_FILES = [
    f'{ROOT}/public/assets/js/mobile_ui.js',
    f'{ROOT}/public/assets/js/mobile_renders.js',
    f'{ROOT}/public/assets/js/mobile.js',
    f'{ROOT}/public/assets/js/app.js',
    f'{ROOT}/public/index.html',
]
BACKUP_DIR = f'{ROOT}/backups/css_refactor_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

# ========================================
# Step 1: Find all used CSS classes
# ========================================
def find_used_classes():
    used = set()
    for jsf in JS_FILES:
        try:
            with open(jsf, 'r', encoding='utf-8') as f:
                content = f.read()
            found = re.findall(r'm-[a-z][a-z0-9-]*', content)
            used.update(found)
        except:
            pass
    return used

# ========================================
# Step 2: CSS Parser
# ========================================
def parse_css_blocks(css_text):
    """Parse CSS into a list of blocks. Each block is:
    - ('comment', text)
    - ('rule', selector, properties_text)
    - ('at_rule', name, body)  -- for @keyframes, @supports
    - ('media_start', condition)
    - ('media_end',)
    """
    blocks = []
    i = 0
    n = len(css_text)
    depth = 0

    while i < n:
        # Skip whitespace
        while i < n and css_text[i] in ' \t\n\r':
            i += 1
        if i >= n:
            break

        # Comment
        if css_text[i:i+2] == '/*':
            end = css_text.find('*/', i+2)
            if end == -1:
                end = n
            else:
                end += 2
            comment = css_text[i:end].strip()
            blocks.append(('comment', comment))
            i = end
            continue

        # @keyframes
        m = re.match(r'@keyframes\s+([a-zA-Z0-9_-]+)\s*\{', css_text[i:])
        if m:
            name = m.group(1)
            start = i + m.end()
            # Find matching closing brace
            brace_depth = 1
            j = start
            while j < n and brace_depth > 0:
                if css_text[j] == '{':
                    brace_depth += 1
                elif css_text[j] == '}':
                    brace_depth -= 1
                j += 1
            body = css_text[start:j-1].strip()
            blocks.append(('keyframes', name, body))
            i = j
            continue

        # @media
        m = re.match(r'@media\s*([^{]+)\{', css_text[i:])
        if m:
            condition = m.group(1).strip()
            blocks.append(('media_start', condition))
            i += m.end()
            depth += 1
            continue

        # @supports
        m = re.match(r'@supports\s*([^{]+)\{', css_text[i:])
        if m:
            condition = m.group(1).strip()
            blocks.append(('supports_start', condition))
            i += m.end()
            depth += 1
            continue

        # Closing brace (end of @media or @supports)
        if css_text[i] == '}':
            if depth > 0:
                blocks.append(('block_end',))
                depth -= 1
            i += 1
            continue

        # Regular rule: selector { properties }
        # Find the opening brace
        brace_pos = css_text.find('{', i)
        if brace_pos == -1:
            break

        selector = css_text[i:brace_pos].strip()
        if not selector:
            i = brace_pos + 1
            continue

        # Find matching closing brace (handle nested braces for inline @supports etc.)
        brace_depth = 1
        j = brace_pos + 1
        while j < n and brace_depth > 0:
            if css_text[j] == '{':
                brace_depth += 1
            elif css_text[j] == '}':
                brace_depth -= 1
            j += 1

        properties = css_text[brace_pos+1:j-1].strip()
        blocks.append(('rule', selector, properties))
        i = j

    return blocks

# ========================================
# Step 3: Parse properties string into dict
# ========================================
def parse_properties(props_text):
    """Parse 'prop: value; prop2: value2;' into OrderedDict"""
    result = OrderedDict()
    # Handle multi-line properties, nested values etc.
    # Split by semicolons that aren't inside parentheses
    parts = []
    depth = 0
    current = ''
    for ch in props_text:
        if ch in '(':
            depth += 1
        elif ch in ')':
            depth -= 1
        elif ch == ';' and depth == 0:
            parts.append(current.strip())
            current = ''
            continue
        current += ch
    if current.strip():
        parts.append(current.strip())

    for part in parts:
        if ':' in part and not part.startswith('/*'):
            colon = part.index(':')
            prop = part[:colon].strip()
            val = part[colon+1:].strip()
            if prop:
                result[prop] = val
    return result

def serialize_properties(props_dict, indent='  '):
    """Convert properties dict back to CSS string"""
    lines = []
    for prop, val in props_dict.items():
        lines.append(f'{indent}{prop}: {val};')
    return '\n'.join(lines)

# ========================================
# Step 4: Check if selector uses dead classes
# ========================================
def selector_is_dead(selector, used_classes):
    """Check if ALL classes in selector are dead (not used)"""
    # Extract all .m-* classes from selector
    classes = re.findall(r'\.m-([a-z][a-z0-9-]*)', selector)
    if not classes:
        return False  # No m- classes, keep it (could be html, body, etc.)

    # For compound selectors like ".m-card.m-selected", ALL must be used
    # For grouped selectors like ".m-card, .m-badge", check each group
    groups = [s.strip() for s in selector.split(',')]
    live_groups = []
    for group in groups:
        group_classes = re.findall(r'\.m-([a-z][a-z0-9-]*)', group)
        if not group_classes:
            live_groups.append(group)
            continue
        # Check if any class in this group is used
        if any(f'm-{c}' in used_classes for c in group_classes):
            live_groups.append(group)

    return len(live_groups) == 0

def filter_selector(selector, used_classes):
    """Remove dead class groups from a selector, return cleaned selector or None"""
    groups = [s.strip() for s in selector.split(',')]
    live_groups = []
    for group in groups:
        group_classes = re.findall(r'\.m-([a-z][a-z0-9-]*)', group)
        if not group_classes:
            live_groups.append(group)
            continue
        if any(f'm-{c}' in used_classes for c in group_classes):
            live_groups.append(group)
    if not live_groups:
        return None
    return ', '.join(live_groups)

# ========================================
# Step 5: Consolidate blocks
# ========================================
def consolidate(blocks, used_classes):
    """Merge duplicate selectors and remove dead code"""

    # Group: key = (context, selector) -> merged properties
    # context = 'global', 'media:...', 'supports:...'
    merged_rules = OrderedDict()  # (context, selector) -> properties dict
    keyframes = OrderedDict()  # name -> body
    comments = []  # (context, comment)
    context_stack = ['global']

    kept_blocks = []  # Final ordered blocks
    seen_selectors = {}  # Track positions for ordering

    for block in blocks:
        btype = block[0]

        if btype == 'comment':
            # Keep section headers (═══), skip version comments
            comment = block[1]
            if '═══' in comment or '---' in comment:
                # Check if it's a meaningful section header
                if any(kw in comment for kw in ['v8.0.', 'v8.1', 'v8.2', 'v8.3', 'v8.4', 'v8.5', 'v8.6', 'v8.7', 'v8.8']):
                    continue  # Skip version-specific headers
                kept_blocks.append(block)
            continue

        elif btype == 'keyframes':
            name = block[1]
            body = block[2]
            keyframes[name] = body  # Last definition wins
            continue

        elif btype == 'media_start':
            context_stack.append(f'media:{block[1]}')
            kept_blocks.append(block)
            continue

        elif btype == 'supports_start':
            context_stack.append(f'supports:{block[1]}')
            kept_blocks.append(block)
            continue

        elif btype == 'block_end':
            if len(context_stack) > 1:
                context_stack.pop()
            kept_blocks.append(block)
            continue

        elif btype == 'rule':
            selector = block[1]
            properties_text = block[2]
            context = context_stack[-1]

            # Filter dead selectors
            filtered_sel = filter_selector(selector, used_classes)
            if filtered_sel is None:
                continue

            # Parse properties
            props = parse_properties(properties_text)
            if not props and not properties_text.strip():
                continue

            key = (context, filtered_sel)

            if key in merged_rules:
                # Merge: later properties override
                merged_rules[key].update(props)
            else:
                merged_rules[key] = props

    return merged_rules, keyframes

# ========================================
# Step 6: Generate clean CSS
# ========================================
def generate_clean_css(merged_rules, keyframes, used_classes):
    """Generate organized CSS output"""

    lines = []
    lines.append('/* ═══════════════════════════════════════════════════════════')
    lines.append('   ASGARD CRM — Mobile Premium v8.8.6 (Consolidated)')
    lines.append('   Refactored: single definition per component, no duplicates.')
    lines.append('   ═══════════════════════════════════════════════════════════ */')
    lines.append('')

    # 1. Keyframes (global, outside media queries)
    lines.append('/* ═══ KEYFRAMES ═══ */')
    for name, body in keyframes.items():
        lines.append(f'@keyframes {name} {{')
        for line in body.split('\n'):
            l = line.strip()
            if l:
                lines.append(f'  {l}')
        lines.append('}')
        lines.append('')

    # 2. Group rules by context
    global_rules = OrderedDict()
    media_rules = {}  # media_condition -> OrderedDict of rules
    supports_rules = {}

    for (context, selector), props in merged_rules.items():
        if context == 'global':
            global_rules[selector] = props
        elif context.startswith('media:'):
            cond = context[6:]
            if cond not in media_rules:
                media_rules[cond] = OrderedDict()
            if selector in media_rules[cond]:
                media_rules[cond][selector].update(props)
            else:
                media_rules[cond][selector] = props
        elif context.startswith('supports:'):
            cond = context[9:]
            if cond not in supports_rules:
                supports_rules[cond] = OrderedDict()
            if selector in supports_rules[cond]:
                supports_rules[cond][selector].update(props)
            else:
                supports_rules[cond][selector] = props

    # 3. Categorize selectors into component groups
    component_order = [
        ('GLOBAL LAYOUT', lambda s: any(x in s for x in ['html', 'body', '#app', '*, *::before', 'img,', 'table:', 'pre,', '::-webkit-scrollbar'])),
        ('UTILITIES', lambda s: any(x in s for x in ['.m-hidden', '.m-mono', '.m-mt-', '.m-title-', '.m-back-', '.m-flex-'])),
        ('PAGE CONTAINER', lambda s: '.m-page' in s and '.m-more-page' not in s),
        ('HEADER', lambda s: '.m-header' in s or '.m-hdr-' in s),
        ('CARD', lambda s: '.m-card' in s and '.m-card-accent' not in s and 'widget' not in s and 'profile' not in s and 'greeting' not in s and 'premium' not in s),
        ('LIST', lambda s: s.strip() == '.m-list' or '.m-list ' in s or '.m-list.' in s),
        ('STATS ROW', lambda s: '.m-stats-row' in s or '.m-stat-' in s),
        ('BADGE', lambda s: '.m-badge' in s),
        ('TOOLBAR', lambda s: '.m-toolbar' in s or '.m-search-input' in s or '.m-search-wrap' in s or '.m-filter-select' in s),
        ('CHIPS & FILTER PILLS', lambda s: '.m-chip' in s or '.m-filter-pill' in s or '.m-filter-bar' in s),
        ('FORM', lambda s: '.m-form' in s or '.m-required' in s),
        ('TABS', lambda s: ('.m-tab' in s and '.m-tabbar' not in s and '.m-tab-mimir' not in s) or '.m-tabs' in s),
        ('TAB BAR (BOTTOM NAV)', lambda s: '.m-tabbar' in s or '.m-bottom-nav' in s or '.m-tab-mimir' in s),
        ('BUTTONS', lambda s: '.m-btn' in s or '.m-approve-btn' in s or '.m-decline-btn' in s or '.m-skip-btn' in s or '.m-info-btn' in s or '.m-action-btn' in s or '.m-action-row' in s),
        ('SECTION', lambda s: '.m-section' in s and '.m-chat-section' not in s and '.m-search-section' not in s and '.m-mail-attachments-section' not in s),
        ('COLLAPSE', lambda s: '.m-collapse' in s),
        ('BOTTOM SHEET', lambda s: '.m-sheet' in s),
        ('CONFIRM DIALOG', lambda s: '.m-confirm' in s),
        ('EMPTY STATE', lambda s: '.m-empty' in s),
        ('SKELETON', lambda s: '.m-skel' in s),
        ('PROGRESS', lambda s: '.m-progress' in s),
        ('TOAST', lambda s: '.m-toast' in s or '.toast' in s or '.asg-toast' in s),
        ('BIG NUMBER', lambda s: '.m-big-number' in s),
        ('QUICK ACTIONS', lambda s: '.m-quick-action' in s),
        ('WIDGET CARDS', lambda s: '.m-widget' in s or '.m-premium-card' in s),
        ('GREETING CARD', lambda s: '.m-greeting' in s),
        ('PROFILE', lambda s: '.m-profile' in s or '.m-p-' in s or '.m-avatar' in s or '.m-rating' in s),
        ('DETAIL FIELDS', lambda s: '.m-detail' in s),
        ('INLINE FIELDS', lambda s: '.m-field' in s and '.m-card-field' not in s and '.m-detail-field' not in s and '.m-chat' not in s and '.m-mail' not in s and '.m-form' not in s and '.m-search' not in s),
        ('CATEGORY ITEMS', lambda s: '.m-category' in s),
        ('CHARTS', lambda s: '.m-chart' in s or '.m-bar' in s or '.m-mini-' in s),
        ('DOTS', lambda s: '.m-dot' in s and '.m-loading-dots' not in s),
        ('DROPDOWN', lambda s: '.m-dropdown' in s),
        ('INFO BANNER', lambda s: '.m-info-banner' in s),
        ('CHAT', lambda s: '.m-chat' in s),
        ('MAIL', lambda s: '.m-mail' in s),
        ('SEARCH OVERLAY', lambda s: '.m-search' in s and '.m-search-input' not in s and '.m-search-wrap' not in s),
        ('OFFLINE & LOADING', lambda s: '.m-offline' in s or '.m-inline-loader' in s or '.m-loading' in s or '.m-retry' in s or '.m-page-loading' in s or '.m-spinner' in s),
        ('PTR (Pull-to-Refresh)', lambda s: '.m-ptr' in s),
        ('FORWARD PICKER', lambda s: '.m-forward' in s),
        ('SWIPE', lambda s: '.m-swipe' in s),
        ('RIPPLE', lambda s: '.m-ripple' in s),
        ('ANIMATIONS', lambda s: '.m-success' in s or '.m-shake' in s or '.m-page-enter' in s or '.m-page-exit' in s or '.m-content-enter' in s),
        ('SCHEDULE TABLE', lambda s: '.m-schedule' in s),
        ('TOGGLE', lambda s: '.m-toggle' in s),
        ('SCROLL', lambda s: '.m-scroll' in s),
        ('MISC OVERRIDES', lambda s: '[data-mobile-native' in s or '.sidebar' in s or '.modalback' in s or '.modal-overlay' in s),
        ('CALC', lambda s: '.m-calc' in s or '.m-consents' in s or '.m-works' in s or '.m-analytics' in s or '.m-more-page' in s or '.m-logout' in s),
        ('CARD ACCENT & SPECIAL', lambda s: '.m-card-accent' in s),
        ('EMAIL', lambda s: '.m-email' in s),
        ('PRELOADER', lambda s: '.asgard-preloader' in s),
        ('WELCOME FORM', lambda s: 'welcome' in s.lower()),
        ('SERVICE WORKER BANNER', lambda s: '.sw-update' in s),
    ]

    def write_rules_section(rules_dict, indent='  '):
        """Write rules grouped by component"""
        categorized = OrderedDict()
        uncategorized = OrderedDict()

        for selector, props in rules_dict.items():
            placed = False
            for cat_name, cat_fn in component_order:
                if cat_fn(selector):
                    if cat_name not in categorized:
                        categorized[cat_name] = OrderedDict()
                    categorized[cat_name][selector] = props
                    placed = True
                    break
            if not placed:
                uncategorized[selector] = props

        result = []
        for cat_name, cat_rules in categorized.items():
            result.append(f'{indent}/* ═══ {cat_name} ═══ */')
            for sel, props in cat_rules.items():
                prop_str = serialize_properties(props, indent + '  ')
                if prop_str:
                    result.append(f'{indent}{sel} {{')
                    result.append(prop_str)
                    result.append(f'{indent}}}')
            result.append('')

        if uncategorized:
            result.append(f'{indent}/* ═══ OTHER ═══ */')
            for sel, props in uncategorized.items():
                prop_str = serialize_properties(props, indent + '  ')
                if prop_str:
                    result.append(f'{indent}{sel} {{')
                    result.append(prop_str)
                    result.append(f'{indent}}}')
            result.append('')

        return result

    # 4. Write global rules
    if global_rules:
        lines.append('/* ═══ GLOBAL RULES (outside media queries) ═══ */')
        for sel, props in global_rules.items():
            prop_str = serialize_properties(props, '  ')
            if prop_str:
                lines.append(f'{sel} {{')
                lines.append(prop_str)
                lines.append('}')
                lines.append('')

    # 5. Write main mobile media query
    main_media = media_rules.get('(max-width: 768px)', OrderedDict())
    if main_media:
        lines.append('@media (max-width: 768px) {')
        lines.append('')
        section_lines = write_rules_section(main_media)
        lines.extend(section_lines)
        lines.append('}')
        lines.append('')

    # 6. Write other media queries
    for cond, rules in media_rules.items():
        if cond == '(max-width: 768px)':
            continue
        lines.append(f'@media {cond} {{')
        for sel, props in rules.items():
            prop_str = serialize_properties(props, '    ')
            if prop_str:
                lines.append(f'  {sel} {{')
                lines.append(prop_str)
                lines.append('  }')
        lines.append('}')
        lines.append('')

    # 7. Write @supports
    for cond, rules in supports_rules.items():
        lines.append(f'@supports {cond} {{')
        for sel, props in rules.items():
            prop_str = serialize_properties(props, '    ')
            if prop_str:
                lines.append(f'  {sel} {{')
                lines.append(prop_str)
                lines.append('  }')
        lines.append('}')
        lines.append('')

    return '\n'.join(lines)


# ========================================
# MAIN
# ========================================
def main():
    print("=" * 60)
    print("  CSS Refactoring: mobile_premium.css")
    print("=" * 60)

    # Backup
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(CSS_PATH, os.path.join(BACKUP_DIR, 'mobile_premium.css'))
    print(f"  Backup: {BACKUP_DIR}")

    # Find used classes
    print("\n[1] Finding used classes...")
    used = find_used_classes()
    print(f"  Found {len(used)} used m-* classes")

    # Read CSS
    print("\n[2] Reading CSS...")
    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        css_text = f.read()
    print(f"  Original: {len(css_text)} chars, {css_text.count(chr(10))} lines")

    # Parse
    print("\n[3] Parsing CSS blocks...")
    blocks = parse_css_blocks(css_text)
    print(f"  Parsed {len(blocks)} blocks")

    # Count block types
    types = {}
    for b in blocks:
        t = b[0]
        types[t] = types.get(t, 0) + 1
    for t, c in sorted(types.items()):
        print(f"    {t}: {c}")

    # Consolidate
    print("\n[4] Consolidating...")
    merged_rules, keyframes = consolidate(blocks, used)
    print(f"  Merged rules: {len(merged_rules)}")
    print(f"  Keyframes: {len(keyframes)}")

    # Count removed
    total_original_rules = sum(1 for b in blocks if b[0] == 'rule')
    total_merged = len(merged_rules)
    removed = total_original_rules - total_merged
    print(f"  Removed/merged: {removed} rules")

    # Generate
    print("\n[5] Generating clean CSS...")
    clean_css = generate_clean_css(merged_rules, keyframes, used)
    clean_lines = clean_css.count('\n') + 1
    print(f"  Clean: {len(clean_css)} chars, {clean_lines} lines")
    print(f"  Reduction: {len(css_text)} → {len(clean_css)} ({100 - int(len(clean_css)/len(css_text)*100)}% smaller)")

    # Write
    print("\n[6] Writing clean CSS...")
    with open(CSS_PATH, 'w', encoding='utf-8') as f:
        f.write(clean_css)
    print(f"  Written: {CSS_PATH}")

    # Stats
    important_count = clean_css.count('!important')
    print(f"\n  !important count: {important_count} (was 336)")

    print("\n" + "=" * 60)
    print("  CSS refactoring complete!")
    print(f"  {css_text.count(chr(10))} → {clean_lines} lines")
    print("=" * 60)


if __name__ == '__main__':
    main()
