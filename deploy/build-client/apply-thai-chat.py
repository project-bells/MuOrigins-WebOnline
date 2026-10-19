"""Opt-in Thai chat candidate for the pinned, already patched browser checkout."""
from pathlib import Path
import sys

root = Path(sys.argv[1]) / 'src/client'
shell = root / 'browser/shell_login.cpp'
ui = root / 'src/UI/UI_LegacyExterns.cpp'
shell_text = shell.read_text(encoding='utf-8-sig')
ui_text = ui.read_text(encoding='utf-8-sig')
if 'MU_THAI_CHAT_CANDIDATE' in shell_text or 'MuThaiText' in ui_text:
    raise SystemExit('STOP: candidate already applied or partial changes; inspect before retry')
needle = '    return 0;\n}\n\nstatic EM_BOOL on_key('
assert shell_text.count(needle) == 1
addition = '''    // MU_THAI_CHAT_CANDIDATE: Unicode Thai -> Windows-874 wire bytes.
    unsigned char c2 = (unsigned char)e->key[2];
    if ((c0 & 0xF0) == 0xE0 && (c1 & 0xC0) == 0x80 &&
        (c2 & 0xC0) == 0x80 && e->key[3] == 0) {
        unsigned cp = ((c0 & 15) << 12) | ((c1 & 63) << 6) | (c2 & 63);
        if ((cp >= 0x0E01 && cp <= 0x0E3A) || (cp >= 0x0E3F && cp <= 0x0E5B))
            return (unsigned char)(cp - 0x0E00 + 0xA0);
    }
'''
shell_text = shell_text.replace(needle, addition + needle)
log = '    printf("LOGIN key %02x slot=%u text=%.16s\\n", ch, (unsigned)DAT_07e11d78, (char*)DAT_07db8710);\n'
assert shell_text.count(log) == 1
shell_text = shell_text.replace(log, '')
marker = 'extern "C" int Mu_GlyphAdvanceSum(const char* s, int n)'
assert ui_text.count(marker) == 1
snippet = Path(__file__).with_name('thai-chat-render.inc').read_text()
ui_text = ui_text.replace(marker, snippet + '\n' + marker)
needle = '    if (!Text_GlyphAtlas()) return n * 8;'
assert ui_text.count(needle) == 1
ui_text = ui_text.replace(needle, needle + '''
    if (MuHasThai(s, n)) {
        MuThaiRun* run = MuThaiText(s, n);
        if (run) return run->width - 4;
    }''')
needle = '    if (!tex || !s || count <= 0) return;'
assert ui_text.count(needle) == 1
ui_text = ui_text.replace(needle, needle + '''
    if (MuHasThai(s, count)) {
        MuThaiRun* run = MuThaiText(s, count);
        if (run) { MuDrawThai(x, baseline, run); return; }
    }''')
# Validate every anchor before writing either source. Existing releases are untouched.
shell.write_text(shell_text, encoding='utf-8')
ui.write_text(ui_text, encoding='utf-8')
print('THAI_CHAT_CANDIDATE_APPLIED: native compile and browser validation pending')
