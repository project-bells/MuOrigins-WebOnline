// Browser in-memory transport bridge for MU Online Solo Classic (0.97k).
// Replaces external WebSocket network calls with a direct in-memory message channel
// connecting client WebAssembly engine to in-browser GameServer Web Worker.

#include <emscripten/emscripten.h>

#include "stdafx.h"
#include "Net/Network.h"
#include "Net/MuEmu.h"
#include "SecureChannel.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

static int g_open = 0;
static int g_pending = 0;
static int g_err = 0;
static char g_host[128] = "127.0.0.1";
static unsigned char* g_in = 0;
static int g_in_cap = 0;
static int g_in_len = 0;
static int g_sends = 0;
static SecureChannel g_secure;
static std::vector<std::vector<unsigned char>> g_early;

// Public Ed25519 identity printed by the 0.97.45 server at startup. This is a
// pin, not a secret: rejecting every other key prevents a gateway or DNS
// compromise from impersonating the game server.
static const unsigned char kServerIdentity[SecureChannel::KeySize] = {
    0xa5,0xa4,0xbb,0x11,0xe7,0x61,0x51,0x6f,
    0xcc,0x80,0x2a,0x4d,0xc4,0xe4,0x85,0x0c,
    0xc7,0xa1,0x48,0x74,0x71,0x67,0xce,0xf2,
    0x30,0x93,0x36,0x76,0x6b,0x1c,0x41,0x67
};

static int raw_send(const unsigned char* data, int len) {
    return EM_ASM_INT({
        try {
            return window.muRemote.send(new Uint8Array(HEAPU8.subarray($0, $0 + $1)));
        } catch (e) { return -1; }
    }, data, len);
}

static bool trust_server(const std::uint8_t identity[SecureChannel::KeySize],
                         const std::uint8_t*, const std::uint8_t*) {
    unsigned char different = 0;
    for (std::size_t i = 0; i < SecureChannel::KeySize; ++i)
        different |= identity[i] ^ kServerIdentity[i];
    return different == 0;
}

static bool browser_random(unsigned char out[SecureChannel::KeySize]) {
    return EM_ASM_INT({
        try {
            globalThis.crypto.getRandomValues(HEAPU8.subarray($0, $0 + $1));
            return 1;
        } catch (e) { return 0; }
    }, out, SecureChannel::KeySize) != 0;
}

static bool send_secure(const unsigned char* plain, int len) {
    for (int offset = 0; offset < len;) {
        const int part = len - offset > (int)SecureChannel::MaxPlain
            ? (int)SecureChannel::MaxPlain : len - offset;
        std::vector<unsigned char> record((std::size_t)part + SecureChannel::Overhead);
        const std::size_t sealed = g_secure.Seal(plain + offset, (std::size_t)part, record.data());
        if (!sealed || raw_send(record.data(), (int)sealed) != (int)sealed) return false;
        offset += part;
    }
    return true;
}

static bool flush_early() {
    for (const auto& packet : g_early)
        if (!send_secure(packet.data(), (int)packet.size())) return false;
    g_early.clear();
    return true;
}

static void note_host(const char* s) {
    if (!s || !s[0]) return;
    strncpy(g_host, s, sizeof(g_host) - 1);
    g_host[sizeof(g_host) - 1] = 0;
}

static void post_event(unsigned evt) {
    gNetwork.OnSocketEvent((WORD)evt, 0);
}

static int append_in(const unsigned char* data, int n) {
    if (n <= 0) return 1;
    if (n > 262144 || g_in_len > 262144 - n) {
        printf("SOLO: recv overflow\n");
        fflush(stdout);
        return 0;
    }
    if (g_in_len + n > g_in_cap) {
        int cap = g_in_cap > 0 ? g_in_cap : 65536;
        while (cap < g_in_len + n) {
            if (cap > 0x2000000) {
                cap = g_in_len + n;
                break;
            }
            cap *= 2;
        }
        unsigned char* grown = (unsigned char*)realloc(g_in, (size_t)cap);
        if (!grown) {
            printf("SOLO: recv overflow\n");
            fflush(stdout);
            return 0;
        }
        g_in = grown;
        g_in_cap = cap;
    }
    memcpy(g_in + g_in_len, data, (size_t)n);
    g_in_len += n;
    return 1;
}

// Windows posts FD_READ again while bytes remain. One call here reads 8 KB
// and returns, so keep going until this message is in the client buffer.
static void drain_in() {
    for (int i = 0; i < 8192 && g_in_len > 0; ++i) {
        int before = g_in_len;
        post_event(FD_READ);
        if (g_in_len >= before) break;
    }
}

extern "C" void mu_net_push_disconnect(void);
static unsigned char g_push_buf[65536];

// Function callable from JS to get buffer pointer for incoming packets
extern "C" EMSCRIPTEN_KEEPALIVE unsigned char* mu_net_get_push_buffer(void) {
    return g_push_buf;
}

// Function callable from JS to push incoming packets from server_worker
extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_packet(int len) {
    if (len > 0 && len <= (int)sizeof(g_push_buf)) {
        std::vector<std::uint8_t> plain;
        if (!g_secure.Receive(g_push_buf, (std::size_t)len, plain)) {
            printf("MU SecureLink: rejected server channel (%d)\n", (int)g_secure.GetFailure());
            mu_net_push_disconnect(); return;
        }
        unsigned char reply[SecureChannel::ClientHelloSize];
        const std::size_t reply_len = g_secure.TakeReply(reply);
        if (reply_len && raw_send(reply, (int)reply_len) != (int)reply_len) {
            mu_net_push_disconnect(); return;
        }
        if (g_secure.IsReady() && !flush_early()) { mu_net_push_disconnect(); return; }
        if (!plain.empty()) {
            if (!append_in(plain.data(), (int)plain.size())) { mu_net_push_disconnect(); return; }
            drain_in();
        }
    }
}

extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_bytes(const unsigned char* data, int len) {
    if (data && len > 0) {
        for (int pos = 0; pos < len; pos += (int)sizeof(g_push_buf)) {
            const int part = len - pos > (int)sizeof(g_push_buf) ? (int)sizeof(g_push_buf) : len - pos;
            memcpy(g_push_buf, data + pos, (std::size_t)part);
            mu_net_push_packet(part);
        }
    }
}

extern "C" int mu_net_last_error(void) { return g_err; }

extern "C" SOCKET mu_net_socket(int, int, int) {
    g_err = 0;
    return (SOCKET)1;
}

extern "C" uint32_t mu_net_inet_addr(const char* s) {
    note_host(s);
    if (!s) return INADDR_NONE;
    unsigned parts[4];
    int n = 0;
    const char* p = s;
    while (*p && n < 4) {
        if (*p < '0' || *p > '9') return INADDR_NONE;
        unsigned v = 0;
        while (*p >= '0' && *p <= '9') {
            v = v * 10u + (unsigned)(*p - '0');
            if (v > 255u) return INADDR_NONE;
            p++;
        }
        parts[n++] = v;
        if (n < 4) {
            if (*p != '.') return INADDR_NONE;
            p++;
        }
    }
    if (n != 4 || *p) return INADDR_NONE;
    return parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24);
}

extern "C" struct hostent* mu_net_gethostbyname(const char* name) {
    note_host(name);
    static char addr[4] = { 127, 0, 0, 1 };
    static char* list[2] = { addr, 0 };
    static struct hostent h;
    h.h_name = g_host;
    h.h_aliases = 0;
    h.h_addrtype = AF_INET;
    h.h_length = 4;
    h.h_addr_list = list;
    g_err = 0;
    return &h;
}

extern "C" int mu_net_async_select(SOCKET, HWND, unsigned, long) {
    g_err = 0;
    return 0;
}

extern "C" int mu_net_connect(SOCKET, const void* addr, int len) {
    g_open = 0;
    g_in_len = 0;
    g_err = 0;
    g_early.clear();
    g_secure.Reset();
    if (!addr || len < (int)sizeof(sockaddr_in)) return -1;
    const sockaddr_in* endpoint = (const sockaddr_in*)addr;
    unsigned short port = htons(endpoint->sin_port); // byte swap; compat header exposes htons only
    g_pending = 1;
    // Protocol 13 replaces the legacy whole-stream XOR on both endpoints.
    MuEmu::SetActive(false);
    unsigned char random[SecureChannel::KeySize];
    if (!browser_random(random)) { g_pending = 0; g_err = 10061; return -1; }
    g_secure.BeginClient(random, trust_server);
    int started = EM_ASM_INT({
        Module['HEAPU8'] = HEAPU8;
        try {
            if (!window.muRemote) return 0;
            window.muRemote.connect(UTF8ToString($0), $1);
            return 1;
        } catch (e) { return 0; }
    }, g_host, port);
    if (!started) { g_pending = 0; g_err = 10061; return -1; }
    g_err = WSAEWOULDBLOCK;
    return -1;
}

extern "C" int mu_net_closesocket(SOCKET) {
    if (g_open || g_pending) {
        EM_ASM({
            if (window.muRemote) window.muRemote.disconnect();
        });
    }
    g_open = g_pending = 0;
    g_in_len = 0;
    g_early.clear();
    g_secure.Reset();
    g_err = 0;
    return 0;
}

extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_open(void) {
    if (!g_pending) return;
    g_pending = 0; g_open = 1; g_err = 0;
    post_event(FD_WRITE);
}

extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_disconnect(void) {
    if (g_open || g_pending) {
        g_open = g_pending = 0;
        g_in_len = 0;
        g_err = 0;
        post_event(FD_CLOSE);
    }
}


extern "C" int mu_net_send(SOCKET, const char* buf, int len, int) {
    if (!g_open) {
        g_err = WSAEWOULDBLOCK;
        return -1;
    }
    if (len <= 0) return 0;

    if (!g_secure.IsReady()) {
        std::size_t queued = 0;
        for (const auto& packet : g_early) queued += packet.size();
        if (queued + (std::size_t)len > 65536) { g_err = 10054; return -1; }
        g_early.emplace_back((const unsigned char*)buf, (const unsigned char*)buf + len);
        g_err = 0;
        return len;
    }
    const bool ok = send_secure((const unsigned char*)buf, len);
    g_err = ok ? 0 : 10054;
    return ok ? len : -1;
}

extern "C" int mu_net_recv(SOCKET, char* buf, int len, int) {
    if (g_in_len <= 0) {
        g_err = WSAEWOULDBLOCK;
        return -1;
    }
    if (!buf || len <= 0) return 0;
    int n = g_in_len < len ? g_in_len : len;
    memcpy(buf, g_in, (size_t)n);
    memmove(g_in, g_in + n, (size_t)(g_in_len - n));
    g_in_len -= n;
    g_err = 0;
    return n;
}
