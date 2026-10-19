// Browser CP874 whole-run rendering: Canvas shapes Thai marks with their base.
struct MuThaiRun {
    GLuint texture;
    int width, height, px, bold, italic;
    char text[512];
};
static MuThaiRun muThaiRuns[64] = {};
static unsigned muThaiNext = 0;
static bool MuHasThai(const char* s, int count) {
    for (int i = 0; i < count; ++i)
        if ((unsigned char)s[i] >= 0xA1) return true;
    return false;
}
static MuThaiRun* MuThaiText(const char* s, int count) {
    if (count <= 0 || count >= 512) return nullptr;
    int px, bold, italic, crisp;
    char face[32];
    CurrentFont(&px, &bold, &italic, &crisp, face);
    for (auto& run : muThaiRuns) {
        if (run.texture && run.px == px && run.bold == bold && run.italic == italic &&
            (int)strlen(run.text) == count && memcmp(run.text, s, count) == 0) return &run;
    }
    MuThaiRun* run = &muThaiRuns[muThaiNext++ % 64];
    if (run->texture) glDeleteTextures(1, &run->texture);
    memset(run, 0, sizeof(*run));
    const int width = 2048, height = px * 3;
    unsigned char* rgba = (unsigned char*)malloc(width * height * 4);
    if (!rgba) return nullptr;
    int measured = EM_ASM_INT({
        var text = new TextDecoder('windows-874').decode(HEAPU8.subarray($0, $0 + $1));
        var canvas = document.createElement('canvas');
        canvas.width = $3; canvas.height = $4;
        var ctx = canvas.getContext('2d');
        ctx.font = ($7 ? 'italic ' : '') + ($6 ? 'bold ' : '') + $5 + 'px Tahoma, "Noto Sans Thai", sans-serif';
        ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'white';
        ctx.fillText(text, 2, $5 * 2);
        HEAPU8.set(ctx.getImageData(0, 0, $3, $4).data, $2);
        return Math.min($3, Math.ceil(ctx.measureText(text).width) + 4);
    }, s, count, rgba, width, height, px, bold, italic);
    glGenTextures(1, &run->texture);
    glBindTexture(GL_TEXTURE_2D, run->texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    free(rgba);
    run->width = measured; run->height = height;
    run->px = px; run->bold = bold; run->italic = italic;
    memcpy(run->text, s, count); run->text[count] = 0;
    return run;
}
static void MuDrawThai(float x, float baseline, MuThaiRun* run) {
    glDisable(GL_DEPTH_TEST); glDisable(GL_ALPHA_TEST);
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glEnable(GL_TEXTURE_2D); glBindTexture(GL_TEXTURE_2D, run->texture);
    DAT_00561574 = 0xFFFFFFFFu;
    const float x0 = x - 2, x1 = x0 + run->width;
    const float y1 = baseline + run->px * 2;
    const float y0 = y1 - run->height;
    const float u = (float)run->width / 2048.0f;
    glBegin(GL_TRIANGLE_FAN);
    glTexCoord2f(0, 0); glVertex2f(x0, y1);
    glTexCoord2f(0, 1); glVertex2f(x0, y0);
    glTexCoord2f(u, 1); glVertex2f(x1, y0);
    glTexCoord2f(u, 0); glVertex2f(x1, y1);
    glEnd(); glDisable(GL_TEXTURE_2D);
}
